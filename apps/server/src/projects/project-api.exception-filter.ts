import { Catch, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import {
  ProjectAlreadyExistsError,
  ProjectRequestValidationError,
  ProjectRevisionConflictError,
  ProjectRevisionNotFoundError,
  ProjectVersionAccessDeniedError,
} from "./prisma-project-version-store.js";
import {
  ProjectReleaseConflictError,
  ProjectReleasePreflightRejectedError,
} from "./prisma-project-release-store.js";
import { ProjectReleaseGateUnavailableError } from "./project-release-safety-gate.js";

interface ProjectApiHttpResponse {
  status(code: number): ProjectApiHttpResponse;
  json(body: unknown): void;
}

/** 仅映射已知工程领域错误；数据库故障和快照完整性错误继续作为服务端异常处理。 */
@Catch(
  ProjectAlreadyExistsError,
  ProjectRequestValidationError,
  ProjectRevisionConflictError,
  ProjectRevisionNotFoundError,
  ProjectVersionAccessDeniedError,
  ProjectReleaseConflictError,
  ProjectReleasePreflightRejectedError,
  ProjectReleaseGateUnavailableError,
)
export class ProjectApiExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      | ProjectAlreadyExistsError
      | ProjectRequestValidationError
      | ProjectRevisionConflictError
      | ProjectRevisionNotFoundError
      | ProjectVersionAccessDeniedError
      | ProjectReleaseConflictError
      | ProjectReleasePreflightRejectedError
      | ProjectReleaseGateUnavailableError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<ProjectApiHttpResponse>();
    let statusCode: number;
    let message: string;

    if (exception instanceof ProjectRequestValidationError) {
      statusCode = HttpStatus.BAD_REQUEST;
      message = exception.message;
    } else if (
      exception instanceof ProjectAlreadyExistsError ||
      exception instanceof ProjectRevisionConflictError ||
      exception instanceof ProjectReleaseConflictError
    ) {
      statusCode = HttpStatus.CONFLICT;
      message = exception.message;
    } else if (exception instanceof ProjectReleasePreflightRejectedError) {
      statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
      message = exception.message;
      response.status(statusCode).json({ statusCode, message, issues: exception.issues });
      return;
    } else if (exception instanceof ProjectReleaseGateUnavailableError) {
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      message = exception.message;
    } else {
      statusCode = HttpStatus.NOT_FOUND;
      message = exception.message;
    }

    response.status(statusCode).json({ statusCode, message });
  }
}
