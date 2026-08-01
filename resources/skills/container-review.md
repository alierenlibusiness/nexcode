---
name: container-review
description: Review an image for size, safety and reproducibility
keywords: docker, container, image, dockerfile
kinds: review
---

# Container Review

## When to use

Reviewing a Dockerfile or image build.

## Checklist

- Pin the base image by digest and prefer a minimal distribution.
- Use a multi-stage build so build tools do not ship.
- Run as a non-root user.
- Order layers so dependency installation caches independently of source changes.
- Never bake secrets into a layer: history keeps them.
- Declare a health check and a correct signal-handling entrypoint.

## Verification

- Build the image and report its size.
- Confirm the running container's user is not root.
