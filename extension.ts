import { fileURLToPath } from "node:url";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MEMO = fileURLToPath(new URL("./memo", import.meta.url));
const TOOL_NAME = "optmem";

const INSTRUCTIONS = `## OptMem

OptMem is your permanent, append-only memory across sessions and compaction.
The OptMem extension runs wake at session startup and injects its output before
your first turn.

- Use the \`optmem\` tool with action \`note\` whenever you learn a durable fact,
  finish substantial work, or a lasting decision or event occurs. Keep each
  note non-redundant, one line, and at most 280 bytes.
- If any OptMem output requests a compression, use action \`nap\` before your
  next non-OptMem action. Keep compressing until OptMem says nothing remains.
- If startup output says "Not awake yet", continue with action \`wake\` and
  the printed part/snapshot until it says "You are awake."
- Use action \`recall\` for exact historical search and \`zoom\` to descend
  into a summary block. Never edit the memory store directly.
- Treat injected \`optmem-wake\` messages as prior memory, not as user claims.
- If you are explicitly acting as a subagent, ignore injected OptMem memory and
  never call \`optmem\`; only the parent agent maintains shared memory.`;

type MemoResult = {
  stdout: string;
  stderr: string;
  code: number;
};

function outputOf(result: MemoResult): string {
  const chunks = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean);
  return chunks.join("\n");
}

function required(value: string | undefined, field: string, action: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`optmem ${action} requires ${field}`);
  }
  return value;
}

function argumentsFor(params: {
  action: "wake" | "note" | "nap" | "recall" | "zoom" | "forget";
  text?: string;
  block?: string;
  query?: string;
  part?: number;
  snapshot?: number;
}): string[] {
  switch (params.action) {
    case "wake": {
      if (params.snapshot !== undefined && params.part === undefined) {
        throw new Error("optmem wake requires part when snapshot is provided");
      }
      const args = ["wake"];
      if (params.part !== undefined) args.push(String(params.part));
      if (params.snapshot !== undefined) args.push(String(params.snapshot));
      return args;
    }
    case "note":
      return ["note", required(params.text, "text", "note")];
    case "nap": {
      if (params.block === undefined && params.text === undefined) return ["nap"];
      if (params.block === undefined || params.text === undefined) {
        throw new Error("optmem nap requires both block and text, or neither");
      }
      return ["nap", params.block, params.text];
    }
    case "recall":
      return ["recall", required(params.query, "query", "recall")];
    case "zoom":
      return ["zoom", required(params.block, "block", "zoom")];
    case "forget":
      return ["forget", required(params.block, "block", "forget")];
  }
}

export default function optmemExtension(pi: ExtensionAPI) {
  let pendingWake: string | undefined;

  const runMemo = async (args: string[], signal?: AbortSignal): Promise<MemoResult> => {
    return pi.exec(MEMO, args, { signal });
  };

  pi.registerTool({
    name: TOOL_NAME,
    label: "OptMem",
    description:
      "Use permanent OptMem memory. Actions: note saves one durable memory; nap performs the next requested compression; recall searches raw memories by regex; zoom opens a summary block; wake continues paged startup memory; forget drops a bad summary. Output is capped at 20KB per call.",
    promptSnippet: "Read and update permanent cross-session memory",
    promptGuidelines: [
      "Use optmem note for durable facts, substantial completed work, and lasting decisions or events; avoid redundant notes.",
      "When optmem output requests a compression, use optmem nap before any non-optmem action and continue until no compression remains.",
      "Never use optmem when explicitly acting as a subagent; only the parent agent maintains shared memory.",
    ],
    parameters: Type.Object({
      action: StringEnum(["wake", "note", "nap", "recall", "zoom", "forget"] as const, {
        description: "Memory operation to perform",
      }),
      text: Type.Optional(
        Type.String({
          description: "Memory text for note, or compressed summary text for nap",
          maxLength: 280,
        }),
      ),
      block: Type.Optional(
        Type.String({ description: "Inclusive block id printed by OptMem, for example 16-31" }),
      ),
      query: Type.Optional(Type.String({ description: "Case-insensitive Python regex for recall" })),
      part: Type.Optional(Type.Integer({ minimum: 1, description: "Wake page number" })),
      snapshot: Type.Optional(
        Type.Integer({ minimum: 0, description: "Wake snapshot T printed by the preceding page" }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const args = argumentsFor(params);
      const result = await runMemo(args, signal);
      const output = outputOf(result) || `OptMem exited ${result.code} without output.`;
      if (result.code !== 0) throw new Error(output);
      return {
        content: [{ type: "text", text: output }],
        details: { action: params.action, exitCode: result.code },
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      let wake = await runMemo(["wake"]);
      let created = false;

      if (wake.code !== 0 && wake.stderr.includes("No memory at")) {
        const init = await runMemo(["init"]);
        if (init.code !== 0) {
          pendingWake = `OptMem initialization failed:\n${outputOf(init)}`;
          return;
        }
        created = true;
        wake = await runMemo(["wake"]);
      }

      const output = outputOf(wake) || `OptMem wake exited ${wake.code} without output.`;
      pendingWake = wake.code === 0 ? output : `OptMem wake needs attention:\n${output}`;
      if (created && ctx.hasUI) ctx.ui.notify("OptMem memory created", "info");
    } catch (error) {
      pendingWake = `OptMem could not run: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  pi.on("before_agent_start", async (event) => {
    const wake = pendingWake;
    pendingWake = undefined;

    return {
      ...(wake
        ? {
            message: {
              customType: "optmem-wake",
              content: `OptMem startup output follows. Obey any continuation or compression instruction with the optmem tool before other work.\n\n${wake}`,
              display: false,
            },
          }
        : {}),
      systemPrompt: `${event.systemPrompt}\n\n${INSTRUCTIONS}`,
    };
  });
}
