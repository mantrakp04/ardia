import asyncio
import base64
import os
import subprocess
import tempfile

from ardia_cli.browse.errors import BrowseError

MAX_BYTES = 40 * 1024 * 1024
EXTRACT_TIMEOUT = 120
NO_TEXT = "(this PDF has no text layer, so it is probably scanned pages; look at it with `ardia browse screenshot`)"
JXA = """ObjC.import("PDFKit");
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (doc.isNil()) return "\\u0000";
  const pages = [];
  for (let i = 0; i < doc.pageCount; i++) {
    const page = doc.pageAtIndex(i);
    pages.push(page.isNil() || page.string.isNil() ? "" : page.string.js);
  }
  return pages.join("\\f");
}"""
FETCH = r"""async (limit) => {
  const response = await fetch(location.href, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}` };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > limit) return { error: `the PDF is ${bytes.length} bytes, over the ${limit}-byte limit` };
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary) };
}"""


def is_pdf_type(kind: str | None) -> bool:
    return (kind or "").split(";")[0].strip().lower() == "application/pdf"


async def page_is_pdf(page, frame=None) -> bool:
    try:
        return is_pdf_type(await page.call("() => document.contentType", frame=frame or page.main_frame, read=True))
    except BrowseError:
        return False


def text_from_bytes(data: bytes) -> str:
    if not data.startswith(b"%PDF"):
        raise BrowseError("the document said it was a PDF but isn't one", code="pdf_unreadable")
    with tempfile.TemporaryDirectory(prefix="ardia-pdf-") as folder:
        path = os.path.join(folder, "document.pdf")
        with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as handle:
            handle.write(data)
        try:
            done = subprocess.run(["osascript", "-l", "JavaScript", "-e", JXA, path], capture_output=True, text=True, timeout=EXTRACT_TIMEOUT)
        except subprocess.TimeoutExpired:
            raise BrowseError(f"reading the PDF's text took over {EXTRACT_TIMEOUT} s", code="pdf_unreadable") from None
    if done.returncode or done.stdout.startswith("\0"):
        raise BrowseError("macOS couldn't open the PDF to read its text", code="pdf_unreadable")
    pages = done.stdout.rstrip("\n").split("\f")
    text = "\n\n".join(f"[page {number} of {len(pages)}]\n{page.strip()}" for number, page in enumerate(pages, 1) if page.strip())
    return text or NO_TEXT


async def page_text(page) -> str:
    from ardia_cli import command_metrics

    got = await page.call(FETCH, MAX_BYTES, frame=page.main_frame, read=True, timeout=EXTRACT_TIMEOUT)
    if got.get("error"):
        raise BrowseError(f"couldn't fetch the PDF to read it: {got['error']}", code="pdf_unreadable")
    command_metrics.flag("read_pdf", True)
    return await asyncio.to_thread(text_from_bytes, base64.b64decode(got["data"]))
