import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
type Job = {id:string;outlet_id:string;source_type:string;source_key:string;event_type:'receipt'|'feedback';payload:Record<string,unknown>;scheduled_at:string;attempts:number};
/** Service-role only. Downstream endpoint must verify HMAC and deduplicate event_id. */
export async function dispatchDueSaleNotifications(db:SupabaseClient, limit=20) {
 const secret=(process.env.SMAV_DISPATCH_SECRET||'').trim();
 if(secret.length<32) throw new Error('SMAV_DISPATCH_SECRET must be at least 32 characters');
 const {data,error}=await db.rpc('smav_claim_due_notifications',{p_limit:Math.min(Math.max(limit,1),50)});
 if(error) throw new Error(error.message);
 const results: {id:string;status:string}[]=[];
 for(const job of (data||[]) as Job[]) {
  try {
   const {data:route,error:routeError}=await db.from('smav_outlet_notification_routes').select('endpoint_url,enabled,send_receipts,send_feedback').eq('outlet_id',job.outlet_id).maybeSingle();
   if(routeError) throw new Error(routeError.message);
   if(!route?.enabled||!route.endpoint_url||(job.event_type==='receipt'&&!route.send_receipts)||(job.event_type==='feedback'&&!route.send_feedback)) {
    await db.from('smav_sale_notification_jobs').update({status:'skipped',last_error:'Outlet route disabled',updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','processing');
    results.push({id:job.id,status:'skipped'});continue;
   }
   if(job.event_type==='feedback'&&Date.parse(job.scheduled_at)<Date.now()-30000) {
    await db.from('smav_sale_notification_jobs').update({status:'skipped',last_error:'Overdue feedback',updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','processing');
    results.push({id:job.id,status:'skipped'});continue;
   }
   const url=new URL(route.endpoint_url);
   if(url.protocol!=='https:') throw new Error('HTTPS required');
   const body=JSON.stringify({event_id:job.id,outlet_id:job.outlet_id,source_type:job.source_type,source_key:job.source_key,event_type:job.event_type,payload:job.payload});
   const timestamp=String(Math.floor(Date.now()/1000));
   const signature=crypto.createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
   const response=await fetch(url.toString(),{method:'POST',headers:{'content-type':'application/json','x-smav-timestamp':timestamp,'x-smav-signature':signature,'x-smav-event-id':job.id},body,signal:AbortSignal.timeout(12000)});
   if(!response.ok) throw new Error(`Downstream HTTP ${response.status}`);
   const {error:markError}=await db.from('smav_sale_notification_jobs').update({status:'sent',last_error:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','processing');
   if(markError) throw new Error(markError.message);
   results.push({id:job.id,status:'accepted'});
  }catch(err:any){
   const retry=job.attempts<5;
   await db.from('smav_sale_notification_jobs').update({status:retry?'pending':'failed',scheduled_at:new Date(Date.now()+Math.min(60,2**job.attempts)*60000).toISOString(),last_error:String(err?.message||err).slice(0,400),updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','processing');
   results.push({id:job.id,status:retry?'retry':'failed'});
  }
 }
 return {processed:results.length,results};
}
