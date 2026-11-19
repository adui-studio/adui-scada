import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  SetMetadata,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { ScadaAuthenticatedRequest } from "../auth/scada-session.guard.js";
import { ScadaProjectGuard, SCADA_PROJECT_PERMISSION } from "../auth/scada-project.guard.js";
import { ScadaSessionGuard } from "../auth/scada-session.guard.js";
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  PrismaProjectVersionStore,
  ProjectRequestValidationError,
} from "./prisma-project-version-store.js";
import { ProjectApiExceptionFilter } from "./project-api.exception-filter.js";
import { PrismaProjectReleaseStore } from "./prisma-project-release-store.js";

/** 仅在 OIDC 显式启用的根模块中注册；所有写入均经过会话、CSRF 与工程 ACL。 */
@ApiTags("工程管理")
@Controller("api/v1/projects")
@UseGuards(ScadaSessionGuard)
@UseFilters(ProjectApiExceptionFilter)
export class ProjectApiController {
  constructor(
    private readonly projects: PrismaProjectVersionStore,
    private readonly releases: PrismaProjectReleaseStore,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "创建工程并原子保存首个历史版本" })
  @ApiCreatedResponse({ description: "工程创建成功，返回工程摘要" })
  @ApiResponse({ status: 400, description: "工程文档或创建请求无效" })
  @ApiResponse({ status: 409, description: "当前租户下已存在相同工程标识" })
  create(@Req() request: ScadaAuthenticatedRequest, @Body() body: unknown) {
    return this.projects.create(request.scadaPrincipal ?? null, body);
  }

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "按工程 ID 升序分页列出当前主体有权读取的工程" })
  @ApiQuery({ name: "limit", required: false, description: "每页数量，默认 20，最大 100" })
  @ApiQuery({
    name: "afterProjectId",
    required: false,
    description: "仅返回工程 ID 严格大于该游标的授权工程",
  })
  @ApiOkResponse({ description: "返回工程摘要数组，不包含完整工程文档" })
  @ApiResponse({ status: 400, description: "工程列表分页参数无效" })
  list(@Req() request: ScadaAuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.projects.list(request.scadaPrincipal ?? null, query);
  }

  @Get(":projectId")
  @Header("Cache-Control", "no-store")
  @UseGuards(ScadaProjectGuard)
  @SetMetadata(SCADA_PROJECT_PERMISSION, "project:read")
  @ApiOperation({ summary: "读取工程详情与当前修订号" })
  @ApiOkResponse({ description: "返回工程摘要" })
  @ApiResponse({ status: 404, description: "工程不存在或无权访问" })
  getProject(@Req() request: ScadaAuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.projects.getProject(request.scadaPrincipal ?? null, projectId);
  }

  @Get(":projectId/versions")
  @Header("Cache-Control", "no-store")
  @UseGuards(ScadaProjectGuard)
  @SetMetadata(SCADA_PROJECT_PERMISSION, "version:read")
  @ApiOperation({ summary: "按修订号倒序分页读取历史版本摘要" })
  @ApiQuery({ name: "limit", required: false, description: "每页数量，默认 20，最大 100" })
  @ApiQuery({
    name: "beforeRevision",
    required: false,
    description: "仅返回小于该修订号的历史版本",
  })
  @ApiOkResponse({ description: "返回历史版本摘要，不包含完整工程文档" })
  @ApiResponse({ status: 400, description: "分页参数无效" })
  @ApiResponse({ status: 404, description: "工程不存在或无权访问" })
  listVersions(
    @Req() request: ScadaAuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.projects.listVersions(request.scadaPrincipal ?? null, projectId, query);
  }

  @Get(":projectId/versions/:revision/release-preflight")
  @Header("Cache-Control", "no-store")
  @UseGuards(ScadaProjectGuard)
  @SetMetadata(SCADA_PROJECT_PERMISSION, "version:read")
  @ApiOperation({ summary: "只读预检已保存的当前工程版本是否兼容 SVG 运行时" })
  @ApiOkResponse({ description: "返回当前版本静态兼容性报告，不包含工程快照正文" })
  @ApiResponse({ status: 400, description: "发布预检修订号无效" })
  @ApiResponse({ status: 404, description: "工程不存在或无权读取版本" })
  @ApiResponse({ status: 409, description: "请求版本不是当前版本，需重新读取版本水位" })
  preflightRelease(
    @Req() request: ScadaAuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("revision") revisionValue: string,
  ) {
    const revision = parseRevisionParam(revisionValue);
    return this.projects.preflightRelease(request.scadaPrincipal ?? null, projectId, revision);
  }

  @Get(":projectId/versions/:revision")
  @Header("Cache-Control", "no-store")
  @UseGuards(ScadaProjectGuard)
  @SetMetadata(SCADA_PROJECT_PERMISSION, "version:read")
  @ApiOperation({ summary: "读取并校验指定历史工程快照" })
  @ApiOkResponse({ description: "返回通过 SHA-256 和数据库元数据校验的完整快照" })
  @ApiResponse({ status: 400, description: "修订号无效" })
  @ApiResponse({ status: 404, description: "工程或指定历史版本不存在，或无权访问" })
  readVersion(
    @Req() request: ScadaAuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("revision") revisionValue: string,
  ) {
    const revision = parseRevisionParam(revisionValue);
    return this.projects.read(request.scadaPrincipal ?? null, projectId, revision);
  }

  @Post(":projectId/versions")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ScadaProjectGuard)
  @SetMetadata(SCADA_PROJECT_PERMISSION, "version:append")
  @ApiOperation({ summary: "通过 CAS 原子追加工程历史版本" })
  @ApiCreatedResponse({ description: "工程版本保存成功，返回完整快照" })
  @ApiResponse({ status: 400, description: "工程保存请求无效" })
  @ApiResponse({ status: 404, description: "工程不存在或无权访问" })
  @ApiResponse({ status: 409, description: "工程版本已变化，请重新获取最新修订号" })
  appendVersion(
    @Req() request: ScadaAuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.append(request.scadaPrincipal ?? null, projectId, body);
  }

  @Post(":projectId/releases")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ScadaProjectGuard)
  @SetMetadata(SCADA_PROJECT_PERMISSION, "release:publish")
  @ApiOperation({ summary: "通过双 CAS 与幂等保护提交正式发布事务" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "由客户端安全随机生成的 UUID v4；不得复用会话令牌或其他凭据",
  })
  @ApiCreatedResponse({ description: "正式发布事件与发布指针已在同一事务中提交" })
  @ApiResponse({ status: 400, description: "正式发布请求或幂等标识无效" })
  @ApiResponse({ status: 401, description: "可信会话无效或已撤销" })
  @ApiResponse({ status: 404, description: "工程不存在或无权执行正式发布" })
  @ApiResponse({ status: 409, description: "工程 head、发布代次或幂等语义发生冲突" })
  @ApiResponse({ status: 422, description: "已保存快照未通过静态发布兼容性检查" })
  @ApiResponse({ status: 503, description: "Runtime、Tag、数据源及工业安全门禁尚未就绪，发布默认拒绝" })
  publish(
    @Req() request: ScadaAuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.releases.publish(
      request.scadaPrincipal ?? null,
      request.scadaSessionId ?? null,
      projectId,
      body,
      idempotencyKey,
    );
  }
}

function parseRevisionParam(value: string): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new ProjectRequestValidationError("查询修订号必须是正整数");
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new ProjectRequestValidationError("查询修订号必须是大于零的安全整数");
  }
  return revision;
}
