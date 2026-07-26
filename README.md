# OptMem for pi

Permanent memory for pi agents. OptMem keeps an append-only log and a compact
binary summary tree, so memory survives sessions, compaction, model changes,
and vendor changes.

![how OptMem works](https://raw.githubusercontent.com/pi-pod/pi-optmem/main/anim/optmem.gif)

## Install

```sh
pi install git:github.com/pi-pod/pi-optmem
```

Python 3.7 or newer is required. Restart pi after installation. On the first
session, the extension creates
`~/.optmem/memory`. It then wakes automatically before the first model turn;
there is no `AGENTS.md` block to paste.

Use a project-local installation with:

```sh
pi install -l git:github.com/pi-pod/pi-optmem
```

Update later with `pi update --extensions`.

## What the extension does

- Runs `memo wake` at every pi session start and injects the result into the
  first turn.
- Registers the `optmem` tool for recording, compressing, searching, and
  navigating memory.
- Adds concise system guidance so durable facts and completed work are noted,
  and requested compressions are completed immediately.
- Initializes a missing memory store only after the extension is deliberately
  installed and started.

The agent-facing tool supports these actions:

| Action | Purpose | Fields |
|---|---|---|
| `note` | Save one durable, non-redundant memory | `text` |
| `nap` | Ask for the next compression, or submit one | none, or `block` + `text` |
| `recall` | Search every raw memory with a regex | `query` |
| `zoom` | Open a summary block into its halves | `block` |
| `wake` | Continue paged startup output | optional `part` + `snapshot` |
| `forget` | Drop a bad summary so it can be rebuilt | `block` |

## Storage and configuration

```
~/.optmem/
  memory/
    LOG.txt     every memory, append-only
    TREE/       rebuildable summary cache
    config      size settings
```

Set `MEMORY_DIR` before starting pi to use another location, such as a synced
folder or Git repository.

The bundled `memo` program remains the storage engine. To inspect or tune a
store outside pi, run it from this checkout:

```sh
./memo config
./memo config WAKE_LINES=300
./memo recall 'project name'
```

Never edit `LOG.txt` or `TREE/` directly.

## Standalone CLI integration

OptMem can still be installed for other agent harnesses with the original
single-file installer:

```sh
curl -fsSL https://raw.githubusercontent.com/VictorTaelin/OptMem/main/install.sh | sh
```

That installer prints the instruction block used by non-pi agents. The pi
extension does not need it.

## Development

```sh
python3 test.py
pi -e .
```

The Python test suite checks tree coverage, persistence, paging, UTF-8,
concurrency, and crash recovery. `pi -e .` loads this repository as a
temporary package for interactive testing.
