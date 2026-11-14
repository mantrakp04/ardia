package com.ardia.sync.core

import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class SyncKeys(entropy: ByteArray) {
    sealed class Failure(message: String) : Exception(message) {
        data object Format : Failure("not a sealed sync file")
        data object Authentication : Failure("the file didn't open with this key")
    }

    private val fileKey = hkdf(entropy, "file-key")
    private val nameKey = hkdf(entropy, "name-key")
    private val passwordKey = hkdf(entropy, "password-key")
    private val passwordNonceKey = hkdf(entropy, "password-nonce-key")

    val chainTag: String = tag("chain")

    fun scopeTag(scope: String): String = tag("scope/$scope")

    private fun tag(label: String): String = Base32.encode(hmac(nameKey, label.toByteArray()).copyOf(16))

    fun seal(payload: ByteArray, scopeTag: String, fileId: String): ByteArray {
        val plain = padded(payload, PADDING)
        val nonce = ByteArray(NONCE_BYTES).also { random.nextBytes(it) }
        val box = gcm(Cipher.ENCRYPT_MODE, fileKey, nonce, associatedData(chainTag, scopeTag, fileId)).doFinal(plain)
        return MAGIC + nonce + box
    }

    fun open(file: ByteArray, scopeTag: String, fileId: String): ByteArray {
        if (file.size < MAGIC.size + NONCE_BYTES + TAG_BYTES + 4 || !file.copyOf(MAGIC.size).contentEquals(MAGIC)) throw Failure.Format
        val nonce = file.copyOfRange(MAGIC.size, MAGIC.size + NONCE_BYTES)
        val box = file.copyOfRange(MAGIC.size + NONCE_BYTES, file.size)
        val plain = try {
            gcm(Cipher.DECRYPT_MODE, fileKey, nonce, associatedData(chainTag, scopeTag, fileId)).doFinal(box)
        } catch (error: AEADBadTagException) {
            throw Failure.Authentication
        } catch (error: java.security.GeneralSecurityException) {
            throw Failure.Authentication
        }
        return unpadded(plain)
    }

    fun sealPassword(password: String, origin: String, username: String): String {
        val plain = padded(password.toByteArray(), PASSWORD_PADDING)
        val aad = passwordAssociatedData(origin, username)
        val synthetic = u32(aad.size) + aad + plain
        val nonce = hmac(passwordNonceKey, synthetic).copyOf(NONCE_BYTES)
        val box = gcm(Cipher.ENCRYPT_MODE, passwordKey, nonce, aad).doFinal(plain)
        return Base64.getEncoder().encodeToString(byteArrayOf(PASSWORD_VERSION) + nonce + box)
    }

    fun openPassword(sealed: String, origin: String, username: String): String {
        val data = try {
            Base64.getDecoder().decode(sealed)
        } catch (error: IllegalArgumentException) {
            throw Failure.Format
        }
        if (data.size < 1 + NONCE_BYTES + TAG_BYTES + 4 || data[0] != PASSWORD_VERSION) throw Failure.Format
        val nonce = data.copyOfRange(1, 1 + NONCE_BYTES)
        val plain = try {
            gcm(Cipher.DECRYPT_MODE, passwordKey, nonce, passwordAssociatedData(origin, username)).doFinal(data, 1 + NONCE_BYTES, data.size - 1 - NONCE_BYTES)
        } catch (error: java.security.GeneralSecurityException) {
            throw Failure.Authentication
        }
        val bytes = unpadded(plain)
        val decoder = Charsets.UTF_8.newDecoder()
        return try {
            decoder.decode(ByteBuffer.wrap(bytes)).toString()
        } catch (error: java.nio.charset.CharacterCodingException) {
            throw Failure.Format
        }
    }

    companion object {
        val MAGIC = "NNS1".toByteArray()
        private val SALT = "netnyahoo-sync/v1".toByteArray()
        const val PADDING = 1024
        private const val PASSWORD_PADDING = 32
        private const val PASSWORD_VERSION: Byte = 1
        private const val NONCE_BYTES = 12
        private const val TAG_BYTES = 16
        private val random = SecureRandom()

        fun newFileId(): String = Base32.encode(ByteArray(16).also { random.nextBytes(it) })

        private fun hkdf(entropy: ByteArray, info: String): ByteArray {
            val prk = hmac(SALT, entropy)
            return hmac(prk, info.toByteArray() + byteArrayOf(1))
        }

        private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
            Mac.getInstance("HmacSHA256").run {
                init(SecretKeySpec(key, "HmacSHA256"))
                doFinal(data)
            }

        private fun gcm(mode: Int, key: ByteArray, nonce: ByteArray, aad: ByteArray): Cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BYTES * 8, nonce))
                updateAAD(aad)
            }

        private fun u32(value: Int): ByteArray = ByteBuffer.allocate(4).putInt(value).array()

        private fun padded(payload: ByteArray, block: Int): ByteArray {
            val length = 4 + payload.size
            return (u32(payload.size) + payload).copyOf(length + (block - length % block) % block)
        }

        private fun unpadded(plain: ByteArray): ByteArray {
            val length = (0 until 4).fold(0L) { acc, i -> (acc shl 8) or (plain[i].toLong() and 0xff) }
            if (length > plain.size - 4) throw Failure.Format
            return plain.copyOfRange(4, 4 + length.toInt())
        }

        fun associatedData(chain: String, scope: String, file: String): ByteArray = MAGIC + "$chain/$scope/$file".toByteArray()

        private fun passwordAssociatedData(origin: String, username: String): ByteArray {
            val originBytes = origin.toByteArray()
            return MAGIC + "password/".toByteArray() + u32(originBytes.size) + originBytes + username.toByteArray()
        }
    }
}
