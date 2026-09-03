import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { AiProviderInput, AiProviderPort, AiProviderResult, AiProviderRuntimeConfig, buildAiUserPrompt } from "./ai-provider.interface";

@Injectable()
export class AnthropicProvider implements AiProviderPort {
  async complete(input: AiProviderInput, config: AiProviderRuntimeConfig): Promise<AiProviderResult> {
    if (!config.apiKey) {
      throw new InternalServerErrorException("Anthropic API key is not configured.");
    }

    const baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxOutputTokens ?? 1024,
        temperature: input.temperature ?? 0.3,
        system: input.systemPrompt ?? "You assist IT support technicians with concise, safe, customer-ready writing.",
        messages: [{ role: "user", content: buildAiUserPrompt(input) }]
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new InternalServerErrorException(`Anthropic request failed with status ${response.status}${details ? `: ${details.slice(0, 300)}` : "."}`);
    }

    const payload = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = payload.content?.find((item) => item.type === "text" || item.text)?.text?.trim();
    if (!text) {
      throw new InternalServerErrorException("Anthropic did not return text.");
    }

    return { model: input.model, text };
  }

}
