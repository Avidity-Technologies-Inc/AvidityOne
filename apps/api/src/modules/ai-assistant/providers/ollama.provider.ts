import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { AiProviderInput, AiProviderPort, AiProviderResult, AiProviderRuntimeConfig, buildAiUserPrompt } from "./ai-provider.interface";

@Injectable()
export class OllamaProvider implements AiProviderPort {
  async complete(input: AiProviderInput, config: AiProviderRuntimeConfig): Promise<AiProviderResult> {
    const baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        options: {
          temperature: input.temperature ?? 0.3,
          num_predict: input.maxOutputTokens ?? undefined
        },
        messages: [
          { role: "system", content: input.systemPrompt ?? "You assist IT support technicians with concise, safe, customer-ready writing." },
          { role: "user", content: buildAiUserPrompt(input) }
        ]
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new InternalServerErrorException(`Ollama request failed with status ${response.status}${details ? `: ${details.slice(0, 300)}` : "."}`);
    }

    const payload = (await response.json()) as { message?: { content?: string | null } };
    const text = payload.message?.content?.trim();
    if (!text) {
      throw new InternalServerErrorException("Ollama did not return text.");
    }

    return { model: input.model, text };
  }
}
