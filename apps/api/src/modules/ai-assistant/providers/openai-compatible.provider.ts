import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { AiProviderInput, AiProviderPort, AiProviderResult, AiProviderRuntimeConfig, buildAiUserPrompt } from "./ai-provider.interface";

@Injectable()
export class OpenAiCompatibleProvider implements AiProviderPort {
  async complete(input: AiProviderInput, config: AiProviderRuntimeConfig): Promise<AiProviderResult> {
    if (!config.apiKey) {
      throw new InternalServerErrorException("AI provider API key is not configured.");
    }

    const baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    if (this.shouldUseResponsesApi(baseUrl, input.model)) {
      return this.completeWithResponsesApi(baseUrl, input, config);
    }

    return this.completeWithChatCompletions(baseUrl, input, config);
  }

  private async completeWithChatCompletions(baseUrl: string, input: AiProviderInput, config: AiProviderRuntimeConfig): Promise<AiProviderResult> {
    const tokenLimit = this.chatCompletionTokenLimit(input);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature ?? 0.3,
        ...tokenLimit,
        messages: [
          { role: "system", content: input.systemPrompt ?? "You assist IT support technicians with concise, safe, customer-ready writing." },
          { role: "user", content: buildAiUserPrompt(input) }
        ]
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new InternalServerErrorException(`AI provider request failed with status ${response.status}${details ? `: ${details.slice(0, 300)}` : "."}`);
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new InternalServerErrorException("AI provider did not return text.");
    }

    return { model: input.model, text };
  }

  private async completeWithResponsesApi(baseUrl: string, input: AiProviderInput, config: AiProviderRuntimeConfig): Promise<AiProviderResult> {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        instructions: input.systemPrompt ?? "You assist IT support technicians with concise, safe, customer-ready writing.",
        input: buildAiUserPrompt(input),
        temperature: this.supportsTemperature(input.model) ? input.temperature ?? 0.3 : undefined,
        max_output_tokens: input.maxOutputTokens ?? undefined
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new InternalServerErrorException(`AI provider request failed with status ${response.status}${details ? `: ${details.slice(0, 300)}` : "."}`);
    }

    const payload = (await response.json()) as {
      output_text?: string | null;
      output?: Array<{ content?: Array<{ text?: string | null; type?: string }> }>;
    };
    const text = this.readResponsesText(payload);
    if (!text) {
      throw new InternalServerErrorException("AI provider did not return text.");
    }

    return { model: input.model, text };
  }

  private shouldUseResponsesApi(baseUrl: string, model: string) {
    if (!this.requiresCompletionTokenLimit(model)) {
      return false;
    }

    try {
      const url = new URL(baseUrl);
      return url.hostname.toLowerCase() === "api.openai.com";
    } catch {
      return false;
    }
  }

  private chatCompletionTokenLimit(input: AiProviderInput) {
    if (!input.maxOutputTokens) {
      return {};
    }
    return this.requiresCompletionTokenLimit(input.model)
      ? { max_completion_tokens: input.maxOutputTokens }
      : { max_tokens: input.maxOutputTokens };
  }

  private requiresCompletionTokenLimit(model: string) {
    const normalized = model.toLowerCase();
    return normalized.startsWith("gpt-5") || /^o[134](?:-|$)/.test(normalized);
  }

  private supportsTemperature(model: string) {
    return !/^o[134](?:-|$)/.test(model.toLowerCase());
  }

  private readResponsesText(payload: { output_text?: string | null; output?: Array<{ content?: Array<{ text?: string | null; type?: string }> }> }) {
    const directText = payload.output_text?.trim();
    if (directText) {
      return directText;
    }

    return payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text?.trim())
      .find(Boolean);
  }
}
