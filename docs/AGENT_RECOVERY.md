# Recovering files with your agent

Liferaft can optionally let a locally running agent search selected indexed archives, inspect a message and recover an attachment or `.eml` file. Ordinary desktop recovery works without an agent. The agent uses Liferaft's existing local indexes and extraction engine; it does not upload an archive or build another index.

## Connect

1. Import the archive in Liferaft and wait until indexing finishes. Archives indexed by older versions need to be reimported once so the index records the original file identity and index revision.
2. Open **Agent access**, select the archives you want to share and choose a recovery folder. Read the sharing notice and confirm the selection.
3. Use the executable and arguments shown by Liferaft in a supported local MCP client. Restart or reconnect that client's Liferaft connection after changing its launch configuration.
4. Ask for a specific recovery, for example: “Find the invoice Alice sent, show me the source message and recover its PDF into my approved folder.” Check the source details before requesting the export.

**A local connection does not make a cloud model local.** Your chosen agent may send requested snippets, message text, sender details, attachment names and recovery results to its provider. Liferaft asks you to acknowledge this when enabling access. Only choose archives you intend that agent to inspect.

The packaged executable starts without a recovery window when given `--mcp`. It uses the same Electron runtime and native SQLite module as the desktop application. The normal app can remain open; indexing, changed files and stale selections are rejected when they would make a recovery ambiguous. The MCP process can also run with the ordinary window closed. It still needs a supported local desktop environment and its existing catalogue.

This interface is local stdio only. A hosted-only chat cannot reach a process on your computer through this configuration. There is no public listener or remote archive endpoint.

### OpenCode

Current OpenCode supports registering a local command with:

```sh
opencode mcp add liferaft -- /absolute/path/to/Liferaft --mcp
```

For paths containing spaces, quote the executable path. Use the exact executable shown by Liferaft. On macOS the packaged executable is normally inside the app bundle, for example `/Applications/Liferaft.app/Contents/MacOS/Liferaft`; a development build needs the additional application path shown by Liferaft.

For configuration-file setup, current OpenCode uses `mcp.servers`:

```json
{
  "mcp": {
    "servers": {
      "liferaft": {
        "type": "local",
        "command": ["/absolute/path/to/Liferaft", "--mcp"]
      }
    }
  }
}
```

Follow the [current OpenCode MCP documentation](https://opencode.ai/docs/mcp-servers) if your installed version uses a different configuration format. The development verification exercises actual stdio protocol requests; it is not a claim that every OpenCode desktop/version combination has been tested.

### Other local MCP clients

Use the executable as the client's stdio command and `--mcp` as its argument. In Codex's TOML configuration, this has the usual form:

```toml
[mcp_servers.liferaft]
command = "/absolute/path/to/Liferaft"
args = ["--mcp"]
```

Check the exact configuration against the client version you use. Client discovery alone is insufficient: verify a fictional search, message inspection and file export before trusting a newly configured combination with real recovery work. Current and legacy MCP wire protocols are exercised by the integration test; installed Codex and OpenCode application combinations still require a local check.

## Scope, sources and revocation

Liferaft keeps an owner-controlled `agent-access.json` in its existing application data directory. The file contains approved archive IDs, approved recovery folders, the sharing acknowledgement and a grant revision. The agent's Liferaft tools cannot create or edit these grants. **Revoke access** disables subsequent calls and checks again before an in-progress export is published.

Search results carry the archive, message and attachment IDs plus an index revision. A connection also receives opaque source references that expire after 30 minutes, on disconnect or when the grant/index changes. A reference from an old index cannot recover a different message that reused the same numeric ID. In Liferaft, select the named archive and check the subject, filename, sender and date in the message preview.

Recovery checks the recorded file identity, size and modification metadata against the original before reading and after extraction. This detects ordinary replacement, edits and reindexing; it is not a cryptographic authenticity check against an attacker with unrestricted access to the same operating-system account.

## Available tools

| Tool                         | Result                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `liferaft_list_archives`     | Approved archives, indexing status and approved recovery-folder IDs.                         |
| `liferaft_search`            | Ranked search over those indexes, with bounded snippets and explicit complete/capped status. |
| `liferaft_read_message`      | Bounded plain text, source details and attachment descriptions for a selected result.        |
| `liferaft_export_attachment` | One selected attachment written to an approved folder.                                       |
| `liferaft_export_message`    | One selected message written as an `.eml` file.                                              |

There are no tools for arbitrary paths, SQL, shell commands, network requests, attachment execution, mail sending or changing grants. All subjects, bodies, addresses and filenames are untrusted archive data. A message cannot grant permission or change what a Liferaft tool can do. This does not restrict other tools that the host agent already has.

Search returns at most 25 results; a capped response asks the agent to narrow the query or archive selection. Message preview reads at most 8 MiB of source and returns at most 12,000 body characters plus 50 attachment descriptions. Large-message previews report their limit; selected attachment recovery remains streamed and is limited to 256 MiB of encoded source per operation. Normal desktop recovery has its own limits.

## Export outcomes

Exports use a sanitised filename and an identity suffix so retries target the same file. Publication is atomic and never overwrites an existing path. The server validates the selected folder's identity again before publication and rejects replaced folders or symlink escapes. Original archives and local indexes are protected.

A successful result reports the actual destination and byte count. Repeating the same recovery in one connection returns its existing receipt when that output is unchanged. If a file already exists after a reconnect, Liferaft reports a collision instead of silently overwriting or producing another copy. Inspect the existing file or approve another folder.

Cancellation stops outstanding reads/writes and removes task-owned temporary output. A cancellation or lost connection immediately after publication may leave the completed file in the approved folder; check it before retrying. Revocation does not delete files already recovered or content already sent to a provider.

## Verification and limitations

`bun test tests/mcp.test.ts` checks the capability boundary and exact extraction with synthetic fixtures. `bun run test:integration` additionally exercises the real importer, native SQLite catalogue/index access, read-only handles and stdio tools over both supported protocol generations. Tests cover no matches, corrupt indexes, stale and missing sources, scope denial, malicious message text, folder replacement, collision/retry, cancellation and revocation before publication.

Build and protocol checks do not establish a shipped desktop release. Release evidence must name the installed version, operating system and architecture, and demonstrate import, search, preview, export and the configured agent journey using fictional mail. Keep unverified operating systems and client combinations explicit. Do not put private mail, source paths or real recovered documents in public evidence.

Implementation uses the maintained [TypeScript MCP server SDK](https://ts.sdk.modelcontextprotocol.io/v2/) and its [stdio lifecycle](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio). Protocol stdout contains JSON-RPC only. Disconnect, interruption and normal shutdown close the connection and its owned database handles.
