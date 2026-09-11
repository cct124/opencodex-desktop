# Bun runtime notices

`LICENSE.md` is the unchanged upstream notice from
https://raw.githubusercontent.com/oven-sh/bun/bun-v1.4.2/LICENSE.md.
SHA-256: `b9caf52728691b4057e371232c221a132883198be2f3d2ddf92c90404c984b1a`.

The installer includes the unmodified Bun 1.4.2 Windows x64 executable from the
repository's pinned npm dependency. Corresponding source and build instructions:
https://github.com/oven-sh/bun/tree/bun-v1.4.2. The upstream notice identifies the
linked libraries and describes rebuilding with a modified JavaScriptCore/WebKit.
Bun remains a separate executable under `runtime/node_modules/bun/bin/bun.exe`;
the desktop shell does not statically link it.

When updating the pinned runtime, refresh this versioned directory from the
matching upstream tag before staging an installer.
