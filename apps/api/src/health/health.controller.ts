import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  livenessResponseSchema,
  readinessResponseSchema,
  type LivenessResponse,
  type ReadinessResponse,
} from '@dokanflow/shared';
import type { Response } from 'express';
import { toOpenApiSchema } from '../common/openapi.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is up and serving requests' })
  @ApiOkResponse({ schema: toOpenApiSchema(livenessResponseSchema) })
  live(): LivenessResponse {
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Readiness: the API can reach Postgres and Redis' })
  @ApiOkResponse({ schema: toOpenApiSchema(readinessResponseSchema) })
  @ApiServiceUnavailableResponse({
    description: 'A dependency is down',
    schema: toOpenApiSchema(readinessResponseSchema),
  })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
