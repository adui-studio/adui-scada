import { DialogPlugin, Input as TInput } from "tdesign-vue-next";

/** 通过 TDesign 模态弹层获取明确授权；关闭、Esc、取消一律拒绝继续执行。 */
export function confirmStudioAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    let dialog: ReturnType<typeof DialogPlugin.confirm> | null = null;
    const finish = (accepted: boolean): void => {
      if (finished) return;
      finished = true;
      dialog?.destroy();
      resolve(accepted);
    };
    dialog = DialogPlugin.confirm({
      header: "确认操作",
      body: message,
      theme: "warning",
      confirmBtn: "确认",
      cancelBtn: "取消",
      closeOnEscKeydown: true,
      closeOnOverlayClick: false,
      onConfirm: () => finish(true),
      onClose: () => finish(false),
    });
  });
}

/** 页面重命名使用 TDesign 输入控件，不将取消视为空字符串。 */
export function promptStudioPageName(current: string): Promise<string | null> {
  return new Promise((resolve) => {
    let name = current;
    let finished = false;
    let dialog: ReturnType<typeof DialogPlugin.confirm> | null = null;
    const finish = (value: string | null): void => {
      if (finished) return;
      finished = true;
      dialog?.destroy();
      resolve(value);
    };
    dialog = DialogPlugin.confirm({
      header: "重命名页面",
      body: (h) =>
        h(TInput, {
          defaultValue: current,
          maxlength: 128,
          placeholder: "请输入新的页面名称",
          onChange: (value: string | number) => {
            name = String(value);
          },
        }),
      confirmBtn: "保存名称",
      cancelBtn: "取消",
      closeOnEscKeydown: true,
      closeOnOverlayClick: false,
      onConfirm: () => finish(name),
      onClose: () => finish(null),
    });
  });
}
