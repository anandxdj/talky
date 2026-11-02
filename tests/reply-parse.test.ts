import { describe, expect, test } from "bun:test";
import {
  MEDIATED_SEND_MAX_PARTS,
  normalizeReplyOutput,
  parseTextToolArgs,
  parseTextToolArgValue,
  parseTextToolCalls,
  splitMediatedText,
  mediatedTextParts,
  splitReplyOutputToMessages,
  stripParsedToolCallText
} from "../src/reply/parse";

describe("normalizeReplyOutput", () => {
  test("NO_REPLY alone (any case, padded) means no reply", () => {
    expect(normalizeReplyOutput("NO_REPLY")).toBe("");
    expect(normalizeReplyOutput("  no_reply \n")).toBe("");
    expect(normalizeReplyOutput("")).toBe("");
    expect(normalizeReplyOutput("   ")).toBe("");
  });

  test("strips embedded NO_REPLY tokens and compacts whitespace (including newlines)", () => {
    expect(normalizeReplyOutput("hi NO_REPLY there")).toBe("hi there");
    expect(normalizeReplyOutput("a\n\n  b")).toBe("a b");
  });

  test("does not strip NO_REPLY inside a longer word", () => {
    expect(normalizeReplyOutput("XNO_REPLY")).toBe("XNO_REPLY");
  });
});

describe("splitReplyOutputToMessages (Gemini auto-reply path)", () => {
  test("single message when there is no separator", () => {
    expect(splitReplyOutputToMessages("hello there")).toEqual(["hello there"]);
  });

  test("splits on ||| and caps at 2 messages", () => {
    expect(splitReplyOutputToMessages("a ||| b")).toEqual(["a", "b"]);
    expect(splitReplyOutputToMessages("a ||| b ||| c ||| d")).toEqual(["a", "b"]);
  });

  test("drops empty parts", () => {
    expect(splitReplyOutputToMessages("a ||| ||| b")).toEqual(["a", "b"]);
    expect(splitReplyOutputToMessages("a|||NO_REPLY")).toEqual(["a"]);
  });

  test("empty / NO_REPLY output sends nothing", () => {
    expect(splitReplyOutputToMessages("")).toEqual([]);
    expect(splitReplyOutputToMessages("NO_REPLY")).toEqual([]);
  });

  test("separator-only output sends nothing (never the literal |||)", () => {
    expect(splitReplyOutputToMessages("|||")).toEqual([]);
    expect(splitReplyOutputToMessages(" ||| ||| ")).toEqual([]);
    expect(splitReplyOutputToMessages("||| NO_REPLY")).toEqual([]);
  });
});

describe("splitMediatedText (Claude mediator /api/claude/send path)", () => {
  test("caps at MEDIATED_SEND_MAX_PARTS (5) and drops the rest", () => {
    expect(MEDIATED_SEND_MAX_PARTS).toBe(5);
    expect(splitMediatedText("1|||2|||3|||4|||5|||6|||7")).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("trims, compacts whitespace and drops empty parts", () => {
    expect(splitMediatedText("  hey  there ||| \n ||| ok\n\nthen ")).toEqual([
      "hey there",
      "ok then"
    ]);
  });

  test("blank / separator-only text yields no parts", () => {
    expect(splitMediatedText("")).toEqual([]);
    expect(splitMediatedText(" ||| ||| ")).toEqual([]);
  });

  test("does not interpret NO_REPLY (Claude decides explicitly)", () => {
    expect(splitMediatedText("NO_REPLY")).toEqual(["NO_REPLY"]);
  });

  test("keeps non-ASCII text intact", () => {
    expect(splitMediatedText("ki khobor 😄 ||| আমি ঠিক আছি — tui?")).toEqual([
      "ki khobor 😄",
      "আমি ঠিক আছি — tui?"
    ]);
  });
});

describe("parseTextToolCalls", () => {
  test("parses known tool calls with key=value args, with and without default_api prefix", () => {
    expect(
      parseTextToolCalls("sure! send_gif(query='happy dance', limit=3) and default_api.send_sticker()")
    ).toEqual([
      { name: "send_gif", args: { query: "happy dance", limit: 3 } },
      { name: "send_sticker", args: {} }
    ]);
  });

  test("a bare positional argument becomes `path`", () => {
    expect(parseTextToolCalls("read_local_file('notes/a.txt')")).toEqual([
      { name: "read_local_file", args: { path: "notes/a.txt" } }
    ]);
  });

  test("ignores unknown tools", () => {
    expect(parseTextToolCalls("unknown_tool(a=1)")).toEqual([]);
    expect(parseTextToolCalls("")).toEqual([]);
    expect(parseTextToolCalls("just chatting, no tools")).toEqual([]);
  });

  // BUG-K4: this used to parse as { query: "'happy (dance" } and leave "')" in the reply text.
  test("a ')' inside a quoted arg stays in the argument", () => {
    expect(parseTextToolCalls("send_gif(query='happy (dance)')")).toEqual([
      { name: "send_gif", args: { query: "happy (dance)" } }
    ]);
    expect(parseTextToolCalls('send_styled_quote_card(text="a) b", style=dark) then send_sticker()')).toEqual([
      { name: "send_styled_quote_card", args: { text: "a) b", style: "dark" } },
      { name: "send_sticker", args: {} }
    ]);
  });

  // BUG-K9: all-caps calls were stripped from the reply text but never executed.
  test("all-caps / mixed-case tool names run as the lowercase tool", () => {
    expect(parseTextToolCalls("SEND_GIF(query='x') and Send_Sticker()")).toEqual([
      { name: "send_gif", args: { query: "x" } },
      { name: "send_sticker", args: {} }
    ]);
    expect(stripParsedToolCallText("ok SEND_GIF(query='x') bye")).toBe("ok bye");
  });

  test("an unclosed quote is treated literally (apostrophes in unquoted args still parse)", () => {
    expect(parseTextToolCalls("send_gif(query=don't stop)")).toEqual([
      { name: "send_gif", args: { query: "don't stop" } }
    ]);
  });

  test("no catastrophic backtracking on hostile incoming text", () => {
    const hostile = `send_gif(${"'a".repeat(20_000)}`;
    const started = performance.now();
    expect(parseTextToolCalls(hostile)).toEqual([]);
    stripParsedToolCallText(hostile);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("parseTextToolArgs / parseTextToolArgValue", () => {
  test("parses quoted strings, booleans, null and numbers", () => {
    expect(
      parseTextToolArgs('a=1, b="x, y", c=true, d=null, e=`t`, f=hello world, g=FALSE')
    ).toEqual({ a: 1, b: "x, y", c: true, d: null, e: "t", f: "hello world", g: false });
  });

  test("empty input yields no args", () => {
    expect(parseTextToolArgs("")).toEqual({});
    expect(parseTextToolArgs("   ")).toEqual({});
  });

  test("value coercion", () => {
    expect(parseTextToolArgValue("'42'")).toBe("42");
    expect(parseTextToolArgValue("42")).toBe(42);
    expect(parseTextToolArgValue("1.5")).toBe(1.5);
    expect(parseTextToolArgValue("0x10")).toBe(16);
    expect(parseTextToolArgValue("Infinity")).toBe("Infinity");
    expect(parseTextToolArgValue("")).toBe("");
    expect(parseTextToolArgValue("Null")).toBeNull();
  });
});

describe("stripParsedToolCallText", () => {
  test("removes tool-call text and tool output blobs, keeps the prose", () => {
    expect(
      stripParsedToolCallText(
        'ok `send_gif(query=\'x\')` done\n```tool_outputs {"a":1}```  bye ```json {"k": 2}```'
      )
    ).toBe("ok done bye");
  });

  test("strips a call whose quoted arg contains ')' completely (BUG-K4)", () => {
    expect(stripParsedToolCallText("haha send_gif(query='happy (dance)') enjoy")).toBe("haha enjoy");
  });

  test("leaves normal text untouched (compacted)", () => {
    expect(stripParsedToolCallText("  hello\nworld ")).toBe("hello world");
    expect(stripParsedToolCallText("")).toBe("");
  });
});

describe("mediatedTextParts (BUG-04)", () => {
  test("counts every non-empty part without capping, so the API can reject >5", () => {
    expect(mediatedTextParts("1|||2|||3|||4|||5|||6")).toHaveLength(6);
    expect(mediatedTextParts(" a ||| ||| b ")).toEqual(["a", "b"]);
  });
});
