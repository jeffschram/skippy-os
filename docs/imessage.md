# Reading Messages

Skippy's ingestion pass can read your iMessage and SMS conversations on the mini. macOS keeps them in a database that only programs with **Full Disk Access** may open.

That access is not given to the Claude app. The Claude app runs the ingestion pass, which reads mail from strangers with nobody watching, and Full Disk Access would let it read every file on the mini. A small program gets the access instead. It does one thing: it copies recent messages into a text file that the pass then reads.

## The parts

| Part | Where | What it does |
| --- | --- | --- |
| The exporter | `~/.skippy-os/bin/skippy-imessage-export` | Opens the Messages database read-only and writes the last 7 days as a transcript. It changes nothing and sends nothing anywhere. Its source is `tools/imessage-export/main.swift`. |
| The transcript | `~/.skippy-os/imessage/recent.txt` | Rewritten at each export. Only your user can read it. |
| The background job | `app.skippyos.imessage-export` | Runs the exporter at ten to the hour before each pass (8:50, 10:50 … 6:50), and once when it is installed. |

## Set it up

Two steps, in either order. Both are yours: Claude cannot change macOS's privacy settings.

1. Give the exporter Full Disk Access.
   - Open **System Settings → Privacy & Security → Full Disk Access**.
   - Press **+**. In the file window press **Cmd+Shift+G**, paste `~/.skippy-os/bin/skippy-imessage-export`, and press Return, then **Open**.
   - Make sure its switch is on.
2. Install the background job:

   ```bash
   tools/imessage-export/install.sh
   ```

   It prints the job's last word. "Wrote N messages from M conversations" means it is working. "authorization denied" means step 1 has not taken effect yet: check the switch, then run the install again.

## To stop it

```bash
tools/imessage-export/install.sh --remove
```

Then remove the exporter from the Full Disk Access list. Deleting `~/.skippy-os/imessage` removes the last transcript.

## If the exporter is rebuilt

macOS ties the access to the exact build. After `tools/imessage-export/build.sh`, remove the exporter from the Full Disk Access list and add it back.
