# Review Status Update

- Verified JWT pipeline now accepts both RS256 (public key) and HS256 (shared secret) tokens, matching issued session tokens across REST and Socket.IO.
- Confirmed user object normalization now populates `req.user.id`, restoring downstream authorization and rate limiting.
- Observed key bundle routes reject invalid `userId` values and run validators when persisting payloads.
- Registration endpoint now guards against duplicate usernames with explicit 400 responses.
