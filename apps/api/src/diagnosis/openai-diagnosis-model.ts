import OpenAI from 'openai';
import {
  diagnosisJsonSchema,
  diagnosisSchema,
  type DiagnosisInput,
  type DiagnosisModel,
  type DiagnosisResult
} from './contract.js';

export class OpenAiDiagnosisModel implements DiagnosisModel {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string
  ) {
    this.client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
  }

  async diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      max_output_tokens: 2_000,
      instructions: [
        'You are CI Doctor\'s diagnosis specialist. Diagnose a failing test from only the supplied evidence bundle.',
        'Do not reveal hidden reasoning or speculate beyond the evidence. Produce a concise visible explanation, ranked hypotheses, falsifiers, and evidence references.',
        'A root-cause claim is invalid unless its evidence references an artifact hash contained in the request.',
        'Do not propose a patch, execute commands, access external systems, or include secrets.'
      ].join(' '),
      input: JSON.stringify(input),
      text: {
        format: {
          type: 'json_schema',
          name: 'ci_doctor_diagnosis',
          strict: true,
          schema: diagnosisJsonSchema
        }
      }
    });

    if (!response.output_text) {
      throw new Error('Diagnosis model returned no structured output');
    }
    return {
      diagnosis: diagnosisSchema.parse(JSON.parse(response.output_text)),
      model: this.model,
      responseId: response.id,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null
    };
  }
}
