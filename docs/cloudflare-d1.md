# Cloudflare Pages D1 Setup

1. Copy `wrangler.example.toml` to the ignored `wrangler.toml` file and create a D1 database, then replace `database_id`.
2. Create a KV namespace using the `AOV_STORE` binding; it stores immutable image bodies under `image:<key>`.
3. Apply the migration: `npx wrangler d1 migrations apply aov-shop --remote`.
4. D1 stores image metadata, ownership, and deletion tombstones so an image key cannot be reused.
5. Deploy normally as Cloudflare Pages. The first administrator is created at `#/admin`; passwords are stored as PBKDF2 hashes in D1 and sessions are stored as hashed tokens in D1.
6. The hosted site is cloud-only: it does not read local folders, supplier configuration, or a local account database.

The Node CLI reads only `AOV_API_URL` and `AOV_ADMIN_TOKEN` from environment variables. For example:

```powershell
$env:AOV_API_URL = 'https://your-project.pages.dev'
$env:AOV_ADMIN_TOKEN = '<login token>'
npm run admin -- list --dry-run
npm run admin -- create --code AOV-001 --status draft --image-key img-<uuid>
npm run admin -- upload --key img-<uuid> --file .\account.png
```

Run `npm run smoke:api` with `AOV_API_URL` set to validate that the public catalog does not leak notes.
