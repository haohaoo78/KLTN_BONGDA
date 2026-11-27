const fs=require('node:fs');
const p='apps/web-client/src/components/LiveMatchCenterPanel.tsx';let s=fs.readFileSync(p,'utf8');
const old='((detail?.clock?.elapsedSeconds ?? 0) + (detail?.clock?.isRunning && detail.clock.startedAt ? Math.max(0, (clockNow - new Date(detail.clock.startedAt).getTime()) / 1000) : 0))';
if(!s.includes(old))throw Error('Clock expression not found');s=s.replace(old,'(detail?.clock ? clockElapsedMilliseconds(detail.clock,Math.max(0,clockNow-clockReceivedAt.current))/1000 : 0)');
s=s.replace('.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || a.createdAt.localeCompare(b.createdAt))','.sort(compareMatchEventTiming)').replace('{event.minute ?? "—"}′','{eventTimeLabel(event)}′');fs.writeFileSync(p,s);
