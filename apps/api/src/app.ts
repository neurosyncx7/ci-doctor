import { createHash } from 'node:crypto';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { parseFailedWorkflowRun } from './domain/workflow-run.js';
import { verifiedIncident } from './dashboard/verified-incident.js';
import { DashboardLiveEvents } from './dashboard/live-events.js';
import type { IncidentStore } from './persistence/incident-store.js';
import { verifyGitHubSignature } from './security/github-signature.js';

type Dependencies = {
  config: AppConfig;
  incidentStore: IncidentStore;
  logger?: FastifyBaseLogger;
  liveEvents?: DashboardLiveEvents;
};

const deliveryIdPattern = /^[A-Za-z0-9-]{16,200}$/;

export async function buildApp(dependencies: Dependencies): Promise<FastifyInstance> {
  const liveEvents = dependencies.liveEvents ?? new DashboardLiveEvents();
  const app = Fastify({
    logger: dependencies.logger ?? {
      level: dependencies.config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-hub-signature-256',
          'req.body',
          'res.headers.set-cookie'
        ],
        censor: '[REDACTED]'
      }
    },
    bodyLimit: 1_048_576,
    requestTimeout: 10_000,
    connectionTimeout: 5_000,
    trustProxy: false,
    requestIdHeader: false
  });

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' }
  });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    ban: 3,
    keyGenerator: (request) => request.ip
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/v1/dashboard/verified-incident', async () => verifiedIncident);
  app.get('/v1/dashboard/stream', async (request, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    reply.raw.write(': connected\n\n');
    const unsubscribe = liveEvents.subscribe((event) => reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
    request.raw.once('close', unsubscribe);
    return reply;
  });
  app.get('/readyz', async (_request, reply) => {
    try {
      await dependencies.incidentStore.ping();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.post('/webhooks/github', { config: { rateLimit: false } }, async (request, reply) => {
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) {
      return reply.code(415).send({ error: 'unsupported_payload' });
    }

    const signature = readHeader(request.headers['x-hub-signature-256']);
    if (!verifyGitHubSignature(rawBody, signature, dependencies.config.githubWebhookSecret)) {
      request.log.warn({ payloadSha256: sha256(rawBody) }, 'Rejected GitHub webhook with invalid signature');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const eventName = readHeader(request.headers['x-github-event']);
    const deliveryId = readHeader(request.headers['x-github-delivery']);
    if (!eventName || !deliveryId || !deliveryIdPattern.test(deliveryId)) {
      return reply.code(400).send({ error: 'invalid_delivery_metadata' });
    }

    if (eventName !== 'workflow_run') {
      return reply.code(202).send({ status: 'ignored' });
    }

    try {
      const payload = JSON.parse(rawBody.toString('utf8')) as unknown;
      const workflow = parseFailedWorkflowRun(payload);
      if (!workflow) {
        return reply.code(202).send({ status: 'ignored' });
      }
      if (!dependencies.config.allowedRepositories.has(workflow.repoFullName)) {
        request.log.warn({ repository: workflow.repoFullName }, 'Rejected webhook for repository outside allowlist');
        return reply.code(403).send({ error: 'repository_not_allowed' });
      }

      const incident = await dependencies.incidentStore.recordFailedWorkflow(
        { deliveryId, eventName, rawBody },
        workflow
      );
      if (incident.created) {
        liveEvents.publish({ type: 'incident.accepted', incidentId: incident.incidentId, repository: workflow.repoFullName, at: new Date().toISOString() });
      }
      return reply.code(202).send({
        status: incident.created ? 'accepted' : 'duplicate',
        incidentId: incident.incidentId || undefined
      });
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return reply.code(400).send({ error: 'invalid_workflow_payload' });
      }
      request.log.error({ err: error }, 'Unable to persist signed GitHub webhook');
      return reply.code(503).send({ error: 'temporarily_unavailable' });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isPayloadTooLargeError(error)) {
      return reply.code(413).send({ error: 'payload_too_large' });
    }
    app.log.error({ err: error }, 'Unhandled API error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  return app;
}

function readHeader(header: string | string[] | undefined): string | undefined {
  return typeof header === 'string' ? header : undefined;
}

function sha256(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function isPayloadTooLargeError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === 413;
}
