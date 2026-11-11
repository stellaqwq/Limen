export const workspaceStyles=String.raw`
:root{--sidebar-width:224px}
.topbar{position:sticky;top:0;z-index:25}
.content{max-width:1480px;padding:28px 32px 88px}
.page-head{margin-bottom:22px}.page-head p{max-width:65ch}
.nav-label{letter-spacing:0}.nav button{min-height:44px}
.overview-actions{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:24px}
.overview-actions .button{justify-content:center;white-space:normal;text-align:center;min-height:46px}
.overview-actions .button.primary{background:var(--accent);color:var(--surface);border-color:var(--accent)}
.overview-actions .button.primary svg{color:inherit}
.overview-pipeline{grid-column:1/-1;border-top:1px solid var(--line);padding:18px 0 0}
.overview-pipeline>summary{cursor:pointer;font-size:14px;font-weight:600;padding:8px 0;min-height:44px}
.overview-pipeline>summary span{color:var(--muted);font-size:12px;font-weight:400;margin-left:12px}
.overview-pipeline .pipeline-details{margin-top:12px;background:var(--surface)}
.overview-pipeline .pipeline-details>.panel-head{border:0}
.agent-control-bar{margin-bottom:12px;padding:0 0 12px;border:0}
.agent-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:var(--surface-muted);border:0;border-radius:10px;margin:0 0 24px}
.agent-tabs button{flex:1 0 auto;border:0;border-radius:7px;min-height:44px;padding:10px 16px;color:var(--muted);font-size:13px;white-space:nowrap}
.agent-tabs button[aria-selected=true]{background:var(--surface);color:var(--accent);font-weight:600}
[data-agent-pane]{scroll-margin-top:88px}
.agent-workflow-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:20px}
.agent-workflow-heading p{max-width:65ch;color:var(--muted);font-size:13px;line-height:1.8}
.agent-workflow-heading .inline-actions{flex-shrink:0}
#agent-pane-devices>.agent-computer{margin:0;padding:22px 0 26px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
#agent-pane-devices>.agent-computer h2{font-size:18px}
.agent-device-options{margin-top:24px}
.agent-device-options details{border-bottom:1px solid var(--line)}
.agent-device-options summary,.agent-compose-details>summary,.agent-tool-directory>summary{padding:18px 0;cursor:pointer;font-size:14px;font-weight:600;min-height:48px}
.agent-device-options summary span,.agent-compose-details>summary span,.agent-tool-directory>summary span{margin-left:12px;color:var(--muted);font-size:12px;font-weight:400}
.agent-device-options .agent-computer{margin:0;padding:0 0 22px;border:0}
.agent-compose-details{border-top:1px solid var(--line);margin-top:24px}
.agent-compose-details .agent-social-form{margin-top:4px}
.agent-default-info{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 14px;margin:0 0 20px;background:var(--surface-muted);border-radius:8px;font-size:13px}
.agent-default-chat{margin-top:0;padding-top:0;border:0}
.agent-default-chat h3{font-size:16px}.agent-default-chat .inline-actions{margin:16px 0 12px}
.agent-tool-directory{border-top:1px solid var(--line);margin-top:24px}
.agent-tool-directory>.panel{border:0;border-radius:0;background:none}
.agent-activity-grid{display:block}
.agent-activity-grid>.panel{margin-bottom:24px}
.plugin-hub-group{margin-bottom:32px}.plugin-hub-group-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:12px}
.plugin-hub-group-head h2{font-size:16px;font-weight:650}.plugin-hub-group-head p{font-size:12px;color:var(--muted)}
.plugin-hub-entries{background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.plugin-hub-row{padding:18px 20px;gap:20px}.plugin-hub-row p{font-size:13px;max-width:66ch}
.plugin-hub-title{margin-bottom:4px}.plugin-hub-title h3{font-size:14px}
.plugin-hub-row .button{min-width:112px;justify-content:center}
.plugin-hub-row:hover{background:var(--surface-muted)}
.plugin-hub-caption{margin-bottom:24px}.plugin-hub-caption h2{font-size:18px}.plugin-hub-caption p{font-size:13px;color:var(--muted);margin-top:6px}
@media(max-width:1190px){:root{--sidebar-width:208px}.content{padding:26px 24px 88px}.agent-workflow-heading{flex-direction:column;gap:14px}.agent-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}#agent-pane-devices>.agent-computer>.agent-computer-bar{align-items:flex-start;flex-direction:column;gap:16px}.overview-actions{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:680px){:root{--sidebar-width:232px}.content{padding:24px 16px 90px}.topbar{padding:0 16px}.page-head{margin-bottom:20px}.overview-actions{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.overview-actions .button{font-size:12px;min-height:48px;padding:10px}.overview-actions .button:last-child{grid-column:1/-1}.agent-control-bar{align-items:flex-start;gap:12px}.agent-control-bar .inline-actions{flex-shrink:0}.agent-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;margin-bottom:20px}.agent-tabs button{min-width:0;padding:10px 6px;font-size:13px}.agent-workflow-heading p{font-size:13px}.agent-workflow-heading .inline-actions{width:100%}.agent-workflow-heading .button{flex:1;justify-content:center}.agent-device-options summary span,.agent-compose-details>summary span,.agent-tool-directory>summary span{display:block;margin:4px 0 0;font-size:12px}.agent-device-options summary,.agent-compose-details>summary,.agent-tool-directory>summary{padding:16px 4px}.agent-default-info{padding:12px;margin-bottom:18px}.plugin-hub-group{margin-bottom:28px}.plugin-hub-row{padding:18px 14px}.plugin-hub-group-head{gap:10px}.plugin-hub-group-head h2{font-size:15px}.plugin-hub-group-head p{font-size:11px}.overview-pipeline>summary span{display:block;margin:5px 0 0}}
`;
