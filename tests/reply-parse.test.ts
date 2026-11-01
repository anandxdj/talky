import { describe, expect, test } from "bun:test";
import {
  MEDIATED_SEND_MAX_PARTS,
  normalizeReplyOutput,
  parseTextToolArgs,
  parseTextToolArgValue,
  parseTextToolCalls,
  splitMediatedText,
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

  test("ignores unknown tools and non-lowercase tool names", () => {
    expect(parseTextToolCalls("unknown_tool(a=1)")).toEqual([]);
    expect(parseTextToolCalls("SEND_GIF(query='x')")).toEqual([]);
    expect(parseTextToolCalls("")).toEqual([]);
    expect(parseTextToolCalls("just chatting, no tools")).toEqual([]);
  });

  test("known limitation: a ')' inside a quoted arg truncates the call", () => {
    expect(parseTextToolCalls("send_gif(query='happy (dance)')")).toEqual([
      { name: "send_gif", args: { query: "'happy (dance" } }
    ]);
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

  test("leaves normal text untouched (compacted)", () => {
    expect(stripParsedToolCallText("  hello\nworld ")).toBe("hello world");
    expect(stripParsedToolCallText("")).toBe("");
  });
});
