import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { AiProviderInput, AiProviderPort, AiProviderResult, AiProviderRuntimeConfig, buildAiUserPrompt } from "./ai-provider.interface";

@Injectable()
export class GeminiProvider implements AiProviderPort {
  async complete(input: AiProviderInput, config: AiProviderRuntimeConfig): Promise<AiProviderResult> {
    if (!config.apiKey) {
      throw new InternalServerErrorException("Gemini API key is not configured.");
    }

    const baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    const requestedModel = this.normalizeConfiguredModel(input.model);
    const response = await this.generateContent(baseUrl, requestedModel, input, config);

    if (!response.ok && response.status === 404) {
      const availableModel = await this.findGenerateContentModel(baseUrl, config, requestedModel);
      if (availableModel && availableModel !== requestedModel) {
        const retryResponse = await this.generateContent(baseUrl, availableModel, input, config);
        if (retryResponse.ok) {
          return this.readTextResult(retryResponse, availableModel);
        }

        const retryDetails = await retryResponse.text();
        throw new InternalServerErrorException(`Gemini fallback model ${availableModel} failed with status ${retryResponse.status}${retryDetails ? `: ${retryDetails.slice(0, 300)}` : "."}`);
      }
    }

    if (!response.ok) {
      const details = await response.text();
      throw new InternalServerErrorException(`Gemini request failed with status ${response.status}${details ? `: ${details.slice(0, 300)}` : "."}`);
    }

    return this.readTextResult(response, requestedModel);
  }

  private generateContent(baseUrl: string, model: string, input: AiProviderInput, config: AiProviderRuntimeConfig) {
    return fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey ?? "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: input.temperature ?? 0.3,
          maxOutputTokens: input.maxOutputTokens ?? undefined
        },
        systemInstruction: {
          parts: [{ text: input.systemPrompt ?? "You assist IT support technicians with concise, safe, customer-ready writing." }]
        },
        contents: [{ role: "user", parts: [{ text: buildAiUserPrompt(input) }] }]
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  }

  private async findGenerateContentModel(baseUrl: string, config: AiProviderRuntimeConfig, requestedModel: string) {
    const response = await fetch(`${baseUrl}/models?key=${encodeURIComponent(config.apiKey ?? "")}`, {
      method: "GET",
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const models = (payload.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => this.normalizeModelName(model.name ?? ""))
      .filter(Boolean);
    if (models.includes(requestedModel)) {
      return requestedModel;
    }

    return this.preferredGeminiModels().find((model) => models.includes(model)) ?? models[0] ?? null;
  }

  private async readTextResult(response: Response, model: string): Promise<AiProviderResult> {
    const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("").trim();
    if (!text) {
      throw new InternalServerErrorException("Gemini did not return text.");
    }

    return { model, text };
  }

  private normalizeModelName(model: string) {
    return model.trim().replace(/^models\//, "");
  }

  private normalizeConfiguredModel(model: string) {
    const normalized = this.normalizeModelName(model);
    if (/^gemini-(1\.5|2\.0)-flash-lite/.test(normalized)) {
      return "gemini-2.5-flash-lite";
    }
    if (/^gemini-(1\.5|2\.0)-flash/.test(normalized)) {
      return "gemini-2.5-flash";
    }

    return normalized || "gemini-2.5-flash";
  }

  private preferredGeminiModels() {
    return ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];
  }
}
