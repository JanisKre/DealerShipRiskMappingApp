import { describe, expect, it } from "vitest";
import {
  LLM_NOT_CONFIGURED,
  OLLAMA_HF_MODEL_PATTERN,
  ggufQuantFromFilename,
  isLlmConfigured,
  isLlmSetupError,
  isLoopbackUrl,
  ollamaHfModelName,
} from "./llm-config";

describe("isLlmConfigured", () => {
  it("is false on first start (no LLM settings)", () => {
    expect(isLlmConfigured(undefined)).toBe(false);
  });

  it("requires a model name", () => {
    expect(
      isLlmConfigured({ provider: "openai", model: " ", hasApiKey: true }),
    ).toBe(false);
  });

  it("requires an API key for the official endpoints", () => {
    expect(isLlmConfigured({ provider: "openai", model: "gpt-4.1-mini" })).toBe(
      false,
    );
    expect(
      isLlmConfigured({
        provider: "claude",
        model: "claude-sonnet-4-6",
        hasApiKey: true,
      }),
    ).toBe(true);
  });

  it("accepts a proxy base URL without an API key", () => {
    expect(
      isLlmConfigured({
        provider: "openai",
        model: "gpt-4.1-mini",
        baseUrl: "http://localhost:6655/openai/v1",
      }),
    ).toBe(true);
  });

  it("requires a base URL for the custom provider", () => {
    expect(
      isLlmConfigured({ provider: "custom", model: "llama", hasApiKey: true }),
    ).toBe(false);
    expect(
      isLlmConfigured({
        provider: "custom",
        model: "llama",
        baseUrl: "http://localhost:11434/v1",
      }),
    ).toBe(true);
  });
});

describe("local provider", () => {
  it("only needs a model (base URL defaults to Ollama, no key)", () => {
    expect(isLlmConfigured({ provider: "local", model: "llama3.2" })).toBe(
      true,
    );
    expect(isLlmConfigured({ provider: "local", model: "" })).toBe(false);
  });

  it("accepts only loopback addresses", () => {
    expect(isLoopbackUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:8080/v1")).toBe(true);
    expect(isLoopbackUrl("http://192.168.1.20:11434/v1")).toBe(false);
    expect(isLoopbackUrl("http://localhost.evil.com/v1")).toBe(false);
    expect(isLoopbackUrl("http://127.0.0.1.nip.io/v1")).toBe(false);
    expect(isLoopbackUrl("file:///etc/passwd")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

describe("Hugging Face GGUF helpers", () => {
  it("extracts the quantization tag of single-file GGUFs", () => {
    expect(ggufQuantFromFilename("Llama-3.2-3B-Instruct-Q4_K_M.gguf")).toBe(
      "Q4_K_M",
    );
    expect(ggufQuantFromFilename("Llama-3.2-3B-Instruct-IQ4_XS.gguf")).toBe(
      "IQ4_XS",
    );
    expect(ggufQuantFromFilename("mistral-7b.Q5_0.gguf")).toBe("Q5_0");
    expect(ggufQuantFromFilename("model-bf16.gguf")).toBe("BF16");
  });

  it("skips files Ollama cannot pull by tag", () => {
    expect(ggufQuantFromFilename("README.md")).toBeNull();
    expect(ggufQuantFromFilename("Q8_0/model-Q8_0.gguf")).toBeNull();
    expect(ggufQuantFromFilename("model-Q8_0-00001-of-00003.gguf")).toBeNull();
    expect(ggufQuantFromFilename("mmproj-model-f16.gguf")).toBeNull();
  });

  it("builds Ollama references that pass the IPC pattern", () => {
    const name = ollamaHfModelName(
      "bartowski/Llama-3.2-3B-Instruct-GGUF",
      "Q4_K_M",
    );
    expect(name).toBe("hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M");
    expect(OLLAMA_HF_MODEL_PATTERN.test(name)).toBe(true);
    expect(OLLAMA_HF_MODEL_PATTERN.test("llama3.2")).toBe(false);
    expect(OLLAMA_HF_MODEL_PATTERN.test("hf.co/../../x:Q4")).toBe(false);
    expect(OLLAMA_HF_MODEL_PATTERN.test("hf.co/a/b:Q4 --insecure")).toBe(false);
  });
});

describe("isLlmSetupError", () => {
  it("matches the not-configured error and auth failures", () => {
    expect(isLlmSetupError(`${LLM_NOT_CONFIGURED}: no model`)).toBe(true);
    expect(isLlmSetupError('LLM 401: {"error":"invalid key"}')).toBe(true);
    expect(isLlmSetupError("Claude 403: forbidden")).toBe(true);
    // Errors from ipcRenderer.invoke arrive wrapped.
    expect(
      isLlmSetupError(
        "Error invoking remote method 'llm:memo': Error: LLM 401: bad key",
      ),
    ).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isLlmSetupError(null)).toBe(false);
    expect(isLlmSetupError("LLM 500: upstream error")).toBe(false);
    expect(isLlmSetupError("fetch failed")).toBe(false);
  });
});
