---
name: secure-file-upload
description: Accept files without accepting code execution
keywords: upload, file, mime, storage, malware
kinds: implement, review
---

# Secure File Upload

## When to use

Any endpoint that accepts a user file.

## Checklist

- Validate type by content sniffing, not by extension or client-supplied MIME.
- Enforce a size limit at the server and stream to disk rather than buffering.
- Generate the stored filename yourself; never use the client's path.
- Store outside the web root and serve through a controlled handler.
- Set Content-Disposition and a restrictive Content-Type on download.
- Scan or sandbox anything that will be opened by another program.

## Verification

- Upload a renamed executable and confirm rejection.
- Upload a path-traversal filename and confirm it is neutralised.
