import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import type { ProjectAccessAction } from "../projects/project-access-policy.js";
import { SCADA_PROJECT_PERMISSION, ScadaProjectGuard } from "./scada-project.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";

/**
 * 未来工程路由必须使用本装饰器，确保先验证会话，再按租户/主体/工程校验 ACL。
 * 正式写入还需继续由 PrismaProjectVersionStore 在事务行锁内复查授权。
 */
export function RequireProjectPermission(action: ProjectAccessAction) {
  return applyDecorators(
    SetMetadata(SCADA_PROJECT_PERMISSION, action),
    UseGuards(ScadaSessionGuard, ScadaProjectGuard),
  );
}
