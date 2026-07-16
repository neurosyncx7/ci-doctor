import { z } from 'zod';

const evidenceRefSchema = z.object({
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
  excerpt: z.string().min(1).max(280)
}).strict();

const hypothesisSchema = z.object({
  rank: z.number().int().min(1).max(3),
  rootCause: z.string().min(12).max(600),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceRefSchema).min(1).max(4),
  falsifier: z.string().min(8).max(400)
}).strict();

export const diagnosisSchema = z.object({
  visibleSummary: z.string().min(20).max(1_200),
  hypotheses: z.array(hypothesisSchema).min(1).max(3),
  nextAction: z.enum(['EXECUTE_REPAIR', 'NEEDS_MORE_EVIDENCE', 'ESCALATE_HUMAN'])
}).strict().superRefine((diagnosis, context) => {
  const ranks = diagnosis.hypotheses.map((hypothesis) => hypothesis.rank);
  if (new Set(ranks).size !== ranks.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Hypothesis ranks must be unique' });
  }
  if (Math.min(...ranks) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The primary hypothesis must have rank 1' });
  }
});

export type Diagnosis = z.infer<typeof diagnosisSchema>;

export type DiagnosisInput = {
  incidentId: string;
  clusterId: string;
  testName: string;
  errorExcerpt: string;
  evidence: Array<{ artifactSha256: string; kind: string; content: string }>;
};

export type DiagnosisResult = {
  diagnosis: Diagnosis;
  model: string;
  responseId: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export interface DiagnosisModel {
  diagnose(input: DiagnosisInput): Promise<DiagnosisResult>;
}

export function validateEvidenceReferences(diagnosis: Diagnosis, permittedArtifactHashes: ReadonlySet<string>): Diagnosis {
  for (const hypothesis of diagnosis.hypotheses) {
    for (const evidence of hypothesis.evidence) {
      if (!permittedArtifactHashes.has(evidence.artifactSha256)) {
        throw new Error(`Diagnosis referenced an artifact outside its evidence bundle: ${evidence.artifactSha256}`);
      }
    }
  }
  return diagnosis;
}

export const diagnosisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['visibleSummary', 'hypotheses', 'nextAction'],
  properties: {
    visibleSummary: { type: 'string', minLength: 20, maxLength: 1200 },
    nextAction: { type: 'string', enum: ['EXECUTE_REPAIR', 'NEEDS_MORE_EVIDENCE', 'ESCALATE_HUMAN'] },
    hypotheses: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rank', 'rootCause', 'confidence', 'evidence', 'falsifier'],
        properties: {
          rank: { type: 'integer', minimum: 1, maximum: 3 },
          rootCause: { type: 'string', minLength: 12, maxLength: 600 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          falsifier: { type: 'string', minLength: 8, maxLength: 400 },
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['artifactSha256', 'excerpt'],
              properties: {
                artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                excerpt: { type: 'string', minLength: 1, maxLength: 280 }
              }
            }
          }
        }
      }
    }
  }
} as const;
