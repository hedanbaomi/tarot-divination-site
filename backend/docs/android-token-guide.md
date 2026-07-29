# Android client: storing and carrying the long-lived device token

This guide describes how the future Quareia Companion Android app should
obtain, store, and send the long-lived device token returned by the backend.

## The model in one paragraph

The app never stores a password. On first launch (or on a fresh install), the
user enters their email; the backend emails a 6-digit code; the app submits it
and receives a **long-lived opaque device token**. The app stores that token
securely and sends it as `Authorization: Bearer <token>` on every authenticated
request. The token stays valid across app restarts, device offline periods, and
server restarts — until the user explicitly logs out, revokes the device, clears
app data, or the account is banned. There are **no** short-lived access tokens,
refresh tokens, or silent rotation.

## 1. Generating a stable `installation_id`

The backend identifies a logical device by a client-generated opaque string
(`installation_id`), **not** by any hardware identifier (no IMEI / MAC /
Android ID). On first launch, generate a random UUID and persist it:

```kotlin
// One-time, at first launch
val installationId = UUID.randomUUID().toString()
// store it (see §2)
```

Reuse the same `installation_id` for the lifetime of the install. If the user
clears app data, generate a new one — that simply creates a new device entry
and a new token after re-login.

## 2. Storing the token and `installation_id`

Use the **Android Keystore-backed EncryptedSharedPreferences** (Jetpack
Security). Never store the token in plain `SharedPreferences`, files, logs, or
backups.

```kotlin
// build.gradle.kts: implementation("androidx.security:security-crypto:1.1.0-alpha06")
val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()

val prefs = EncryptedSharedPreferences.create(
    context,
    "quareia_auth",
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
)

fun saveSession(deviceToken: String, installationId: String) {
    prefs.edit()
        .putString("device_token", deviceToken)
        .putString("installation_id", installationId)
        .apply()
}

fun deviceToken(): String? = prefs.getString("device_token", null)
fun installationId(): String? = prefs.getString("installation_id", null)
```

To prevent the token from being included in Google backups, mark the file as
not backup-able in `AndroidManifest.xml` or via
`BackupDataOutput` — or exclude it with a `full_backup_content` rule.

## 3. Login flow

```kotlin
suspend fun login(email: String): Result<Unit> = runCatching {
    // 1. request code
    api.sendCode(SendCodeRequest(email = email, installationId = installationId))
    // 2. user reads code from email, enters it in the UI
    val code = awaitUserEnteredCode()
    // 3. verify
    val resp = api.verifyCode(VerifyCodeRequest(
        email = email,
        code = code,
        installationId = installationId,
        deviceName = Build.MODEL,
        platform = "android",
    ))
    saveSession(resp.deviceToken, installationId)
}
```

`deviceToken` is returned **exactly once**. Store it immediately; there is no
way to fetch it again. If lost, the user logs in again (a new device session).

## 4. Sending the token on every request

Add an OkHttp `Interceptor` so you never forget it and it never appears in logs:

```kotlin
class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request().newBuilder()
            .apply {
                tokenProvider()?.let { header("Authorization", "Bearer $it") }
            }
            .build()
        return chain.proceed(req)
    }
}
```

**Disable OkHttp/HttpLoggingInjector from logging the Authorization header.**
If you use `HttpLoggingInterceptor`, set its level to `HEADERS` and use a
redacting interceptor, or `NONE` in release builds. The server also redacts
token-like strings from its own logs, but the client must not leak them first.

## 5. Handling 401

A 401 means the token is invalid or revoked (logout, device revoke, account
ban, or app-data clear on a fresh install). On 401:

1. Clear the stored token.
2. Prompt the user to log in again (email + code).
3. Do **not** retry in a tight loop.

Do not treat a network failure (no connectivity, timeout) as an auth failure —
the token is still valid; just retry later. The token survives the server being
down or the device being offline.

## 6. Multiple devices

Each install (each `installation_id`) gets its own token, all bound to the same
email/account. The user can list and revoke other devices via
`GET /api/v1/me/devices` and `DELETE /api/v1/me/devices/{device_id}`. Revoking
a device does **not** delete that user's cloud notes.

## 7. Logout

- **This device only:** `POST /api/v1/auth/logout` (sends the current token),
  then clear the local token.
- **Everywhere:** `POST /api/v1/auth/logout-all`, then clear the local token.
