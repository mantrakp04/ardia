package com.ardia.sync

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.ardia.sync.core.FileKeyStore
import com.ardia.sync.core.SyncKeyStore
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class KeystoreKeyStore(directory: File, private val alias: String = "Ardia Sync Key") : SyncKeyStore {
    private val sealed = FileKeyStore(directory)

    override fun load(account: String): ByteArray? {
        val box = sealed.load(account) ?: return null
        if (box.size <= NONCE_BYTES) return null
        val key = existingKey() ?: return null
        return try {
            Cipher.getInstance(TRANSFORMATION).run {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, box, 0, NONCE_BYTES))
                updateAAD(account.toByteArray())
                doFinal(box, NONCE_BYTES, box.size - NONCE_BYTES)
            }
        } catch (error: Exception) {
            null
        }
    }

    override fun save(secret: ByteArray, account: String): Boolean {
        val box = try {
            Cipher.getInstance(TRANSFORMATION).run {
                init(Cipher.ENCRYPT_MODE, existingKey() ?: createKey())
                updateAAD(account.toByteArray())
                val body = doFinal(secret)
                iv + body
            }
        } catch (error: Exception) {
            return false
        }
        return sealed.save(box, account)
    }

    override fun delete(account: String) = sealed.delete(account)

    private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    private fun existingKey(): SecretKey? = (keyStore().getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.secretKey

    private fun createKey(): SecretKey =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).run {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }

    companion object {
        private const val PROVIDER = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val NONCE_BYTES = 12
    }
}
