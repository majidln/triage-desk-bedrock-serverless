import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

// The caller of an API route: the `sub` of the token the API's JWT authorizer has already
// checked. Undefined means the route isn't behind the authorizer; the handler refuses with a
// 401 rather than guessing a user.
export function callerId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string | undefined {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  return typeof sub === 'string' && sub !== '' ? sub : undefined;
}
