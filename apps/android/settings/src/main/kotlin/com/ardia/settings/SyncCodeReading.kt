package com.ardia.settings

import com.ardia.sync.SyncJoin
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.EncodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.BitMatrix
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

sealed interface ScanVerdict {
    data class Accept(val phrase: String) : ScanVerdict

    data object Reject : ScanVerdict

    data object Repeat : ScanVerdict
}

class SyncCodeJudge(private val isValid: (String) -> Boolean = { SyncJoin.check(it).isValid }) {
    private var lastPayload: String? = null

    fun judge(payload: String): ScanVerdict {
        if (payload == lastPayload) return ScanVerdict.Repeat
        lastPayload = payload
        return if (isValid(payload)) ScanVerdict.Accept(payload.trim()) else ScanVerdict.Reject
    }
}

class QrDecoder {
    private val reader = QRCodeReader()
    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.TRY_HARDER to true,
        DecodeHintType.CHARACTER_SET to "UTF-8",
    )

    fun decode(luminance: ByteArray, width: Int, height: Int, rowStride: Int): String? {
        val source = PlanarYUVLuminanceSource(luminance, rowStride, height, 0, 0, width, height, false)
        return decode(source) ?: decode(source.invert())
    }

    fun decode(source: LuminanceSource): String? = try {
        reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
    } catch (missing: NotFoundException) {
        null
    } catch (unreadable: ReaderException) {
        null
    } finally {
        reader.reset()
    }
}

object SketchQr {
    const val CONTENT = "https://ardia.dev"

    val matrix: BitMatrix by lazy {
        QRCodeWriter().encode(CONTENT, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 0, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M))
    }
}
