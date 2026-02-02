// Integration tests for onboarding flow
// Tests webhook endpoint behavior: creation, idempotency, validation, auth

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock agent-creator and state-manager BEFORE importing app
vi.mock('../services/agent-creator.js', () => ({
  createAgent: vi.fn(),
}));

vi.mock('../services/state-manager.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getState: vi.fn(),
    createState: vi.fn(),
    initDatabase: vi.fn(),
  };
});

// Import app after mocking (env vars set in vitest.setup.ts)
import app from '../index.js';

// Import mocked modules after vi.mock
import { createAgent } from '../services/agent-creator.js';
import { getState } from '../services/state-manager.js';

// Cast mocked functions to vitest mocks
const mockCreateAgent = createAgent as ReturnType<typeof vi.fn>;
const mockGetState = getState as ReturnType<typeof vi.fn>;

const testToken = 'test-hook-token';

describe('onboarding flow', () => {
  const validPhone = '+15551234567';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('testWebhookCreatesAgent - should create agent for new phone', async () => {
    // Arrange: Mock no existing state, successful agent creation
    mockGetState.mockReturnValue(null);
    mockCreateAgent.mockResolvedValue('user_abc123');

    // Act: Call webhook
    const response = await request(app)
      .post('/webhook/onboarding')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ phone: validPhone });

    // Assert: 201 created with agent ID
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      status: 'created',
      agentId: 'user_abc123',
      phone: validPhone,
    });

    // Verify createAgent called exactly once with correct phone
    expect(mockCreateAgent).toHaveBeenCalledTimes(1);
    expect(mockCreateAgent).toHaveBeenCalledWith({ phoneNumber: validPhone });
  });

  it('testIdempotentCall - should return existing agent on duplicate call', async () => {
    // Arrange: Mock existing state
    const existingState = { agent_id: 'user_existing', status: 'active' };
    mockGetState.mockReturnValue(existingState);

    // Act: First call
    const response1 = await request(app)
      .post('/webhook/onboarding')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ phone: validPhone });

    // Act: Second call with same phone
    const response2 = await request(app)
      .post('/webhook/onboarding')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ phone: validPhone });

    // Assert: First call returns 200 (existing), second also 200
    expect(response1.status).toBe(200);
    expect(response1.body).toEqual({
      status: 'existing',
      agentId: 'user_existing',
    });

    expect(response2.status).toBe(200);
    expect(response2.body).toEqual({
      status: 'existing',
      agentId: 'user_existing',
    });

    // Verify getState called on both requests (idempotent check)
    expect(mockGetState).toHaveBeenCalledTimes(2);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('testInvalidPhone - should reject non-E.164 phone format', async () => {
    // Act: Call webhook with invalid phone
    const response = await request(app)
      .post('/webhook/onboarding')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ phone: 'invalid' });

    // Assert: 400 bad request with error message
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid phone format',
      details: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Invalid E.164 phone format'),
        }),
      ]),
    });

    // Verify createAgent NOT called
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('testMissingAuth - should reject request without authorization header', async () => {
    // Act: Call webhook WITHOUT Authorization header
    const response = await request(app)
      .post('/webhook/onboarding')
      .send({ phone: validPhone });

    // Assert: 401 unauthorized
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'Missing authorization header',
    });

    // Verify createAgent NOT called
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });
});
