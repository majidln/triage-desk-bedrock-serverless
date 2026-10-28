import { describe, expect, it } from '@jest/globals';
import {
  AccessDeniedException,
  InternalServerException,
  ModelErrorException,
  ModelNotReadyException,
  ModelTimeoutException,
  ResourceNotFoundException,
  ServiceQuotaExceededException,
  ServiceUnavailableException,
  ThrottlingException,
  ValidationException,
} from '@aws-sdk/client-bedrock-runtime';
import { classifyError, PermanentError } from '../../shared/classify-error';

// Real SDK exceptions, built the way the client builds them.
const opts = { message: 'test', $metadata: {} };

describe('classifyError', () => {
  it.each([
    ['ThrottlingException', new ThrottlingException(opts)],
    ['ServiceUnavailableException', new ServiceUnavailableException(opts)],
    ['InternalServerException', new InternalServerException(opts)],
    ['ModelTimeoutException', new ModelTimeoutException(opts)],
    ['ModelNotReadyException', new ModelNotReadyException(opts)],
    ['ModelErrorException', new ModelErrorException(opts)],
  ])('treats Bedrock %s as transient', (_name, err) => {
    expect(classifyError(err)).toBe('transient');
  });

  it.each([
    ['ValidationException', new ValidationException(opts)],
    ['AccessDeniedException', new AccessDeniedException(opts)],
    ['ResourceNotFoundException', new ResourceNotFoundException(opts)],
    ['ServiceQuotaExceededException', new ServiceQuotaExceededException(opts)],
  ])('treats Bedrock %s as permanent', (_name, err) => {
    expect(classifyError(err)).toBe('permanent');
  });

  it('treats our own PermanentError as permanent', () => {
    expect(classifyError(new PermanentError('message body is not JSON'))).toBe('permanent');
  });

  it.each([
    ['a plain Error', new Error('ECONNRESET')],
    ['an unknown AWS error name', Object.assign(new Error('x'), { name: 'SomethingNewException' })],
    ['a thrown string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('treats %s as transient', (_label, err) => {
    expect(classifyError(err)).toBe('transient');
  });
});
