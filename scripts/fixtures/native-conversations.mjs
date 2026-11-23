/** Native composer fixture: no remote hosts, credentials, or model calls. */
const entries = ["antigravity", "claude"].map(provider => ({
  key: JSON.stringify(["lab-gpu", provider, `preview-${provider}`]), host: "lab-gpu", provider,
  sessionId: `preview-${provider}`, cwd: "/workspace/research", title: `${provider === "claude" ? "Claude" : "AGY"} 论文修改`, model: "", updatedAt: Date.now(), managed:true,
}));
const states = new Map(entries.map(entry => [entry.key,{...entry,turns:[],interactive:true,status:"waiting_permission",permissionMode:"default",controlResults:[],permissions:[entry.provider === "claude" ? {
  id:"preview-question",tool:"AskUserQuestion",input:{questions:[
    {question:"希望优先完善哪些内容？",multiSelect:true,options:[{label:"对话体验",description:"消息、工具记录与输入控件"},{label:"任务调度",description:"跨项目运行与资源分配"},{label:"项目管理",description:"目录、会话与归档"}]},
    {question:"希望以什么形式汇报？",options:[{label:"简短结论"},{label:"详细说明"}]}]},
} : {id:"preview-form",kind:"acp-form",tool:"提问",input:{},description:"请选择本轮需要检查的项目。",fields:[{name:"targets",title:"需要检查哪些控件？",type:"array",required:true,minItems:1,options:[{value:"1",label:"模型选择"},{value:"2",label:"权限审批"},{value:"3",label:"多选问题"}]}]}] }]));
export function nativeConversationFixture(request, response, url, json) {
  if (url.pathname === "/api/session-catalog") { json(response, 200, { entries, scans: [], scanning: false }); return true; }
  if (url.pathname === "/api/cli-conversations") {
    const entry = entries.find(item => item.key === url.searchParams.get("key"));
    json(response, 200, entry ? states.get(entry.key) : { entries: [...states.values()] }); return true;
  }
  if (url.pathname === "/api/cli-conversations/commands" || url.pathname === "/api/session/commands") {
    json(response,200,{commands:[{name:"compact",description:"压缩当前会话上下文"},{name:"review",description:"检查项目中的变更"},{name:"project:check",description:"当前项目定义的检查技能"}]});return true;
  }
  if (url.pathname === "/api/cli-conversations/control") {
    let body="";request.on("data",chunk=>body+=chunk);request.on("end",()=>{
      const input=JSON.parse(body);const state=states.get(input.key);
      state.controlResults.push({id:input.id,status:"accepted"});state.permissions=[];state.status="completed";
      state.turns=[{id:"preview-reply",prompt:"提交回答",status:"completed",text:`已收到：${JSON.stringify(input.answers || input.content || input.decision)}`}];
      json(response,202,{status:"queued",controlId:input.id});
    });return true;
  }
  if (url.pathname === "/api/cli-conversations/models") {
    const agy = url.searchParams.get("provider") === "antigravity";
    json(response, 200, { models: agy ? ["low", "medium", "high"].map(level => ({ id: `gemini-2.5-pro-${level}`, label: `Gemini 2.5 Pro ${level}`, currentEffort: level, efforts: ["low", "medium", "high"], effortModels: { low: "gemini-2.5-pro-low", medium: "gemini-2.5-pro-medium", high: "gemini-2.5-pro-high" }, supportsAutoMode: false })) : [{ id: "default", label: "主机默认", efforts: ["low", "high"], supportsAutoMode: true }, { id: "opus", label: "Opus", efforts: ["low", "high"], supportsAutoMode: true }] }); return true;
  }
  if (url.pathname === "/api/session-catalog/dialogue") {
    json(response, 200, { version: "preview-v1", messages: [{ id: "1", role: "user", text: "核对这段论文表述，保留公式和原始引用。" }, { id: "2", role: "assistant", text: "已整理实验描述。\n\n**新增表述**：\n\n`Without training an actor, \\method{} achieves the highest success rate on all four visual manipulation datasets, whereas the baseline pixel actor \\cite{baseline2026} reaches higher scores on DMC-RGB and the visual mazes (\\cref{tab:zeroshot-pixels}).`\n\n**公式**：`e(\\va)=\\widehat{J}(\\va)-J^\\beta(\\va)`\n\n保留方法名与引用宏，便于与论文源码核对。" }], summaryOnly: false, limited: false, nextBefore: null }); return true;
  }
  return false;
}
