let head;
then(() => picShown().then(() => row(folder().id)).then((r) => { head = r; return rows(); }).then((r) => snap("rest", { head, rows: r })));
then(() => ac.shell.devSetPointer(W, { x: head.x + 90, y: head.y + head.height / 2 }).then(() => sleep(400)).then(() => snap("hover", { head })));
then(() => GM.openGroupMenu(W, folder().id).then(() => sleep(1500)));
then(() => ac.shell.devSetPointer(W, null).then(() => sleep(600)).then(() => picShown()).then(() => rows()).then((r) => row(folder().id).then((h) => snap("shared", { head: h, rows: r }))));
return finish({ links: linksOf(folder()) });
