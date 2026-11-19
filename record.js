/* Record form (formerly Inky): makes one record at a time and saves it to the encrypted library. */

(()=>{'use strict';
/* ---------- helpers ---------- */
const $=id=>document.getElementById(id);
const h=(tag,attrs,...kids)=>{const e=document.createElement(tag);for(const[k,v] of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v===true?'':v)}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)))}return e};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(3,'0');
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const parseD=d=>{const[y,m,dd]=String(d||'').split('-').map(Number);const x=new Date(y,(m||1)-1,dd||1);return isNaN(x)?null:x};
const fmtDate=(d,long)=>{const x=parseD(d);return x?x.toLocaleDateString('en-US',long?{weekday:'long',month:'long',day:'numeric',year:'numeric'}:{month:'short',day:'numeric',year:'numeric'}):(d||'')};
const monthYear=d=>{const x=parseD(d)||new Date();return x.toLocaleDateString('en-US',{month:'long',year:'numeric'}).toUpperCase()};
const fmtTime=t=>{if(!t)return'';const[H,M]=t.split(':').map(Number);if(isNaN(H))return t;return `${(H%12)||12}:${String(M||0).padStart(2,'0')} ${H>=12?'PM':'AM'}`};
const money=a=>{if(a===''||a==null)return'';const n=Number(a);return isFinite(n)?n.toLocaleString('en-US',{style:'currency',currency:'USD'}):String(a)};
const stamp=iso=>new Date(iso).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
const TZ=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch{return''}})();
const fmtSize=b=>b<1024?b+' bytes':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(2)+' MB';
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function toast(msg){if(window.App)App.toast(msg)}

/* ---------- field builders ---------- */
const f=(k,l,t='text',x={})=>({k,l,t,...x});
const chips=(k,l,o,x={})=>f(k,l,'chips',{o,...x});
const ta=(k,l,x={})=>f(k,l,'textarea',x);
const DATE=(l='Date')=>f('date',l,'date');
const TIME=(l='Time')=>f('time',l,'timeacc');
const CHILD=f('children','Child or children','text',{ph:'First names'});
const LOC=(l='Location')=>f('location',l,'text',{ph:'Address, place, or "online"'});
const PEOPLE=(l='People involved')=>ta('people',l,{rows:2,ph:'Names and roles, e.g. Jordan (other parent)'});
const QUOTES=ta('quotes','Exact statements you remember',{hint:'Only wording you are sure of. Start with who said it, e.g.  Jordan: "..."',pl:'Exact statements (as recalled)'});
const OBSV=ta('observed','What did you personally see or hear?',{pl:'Personally seen or heard'});
const REPT=ta('reported','What were you told by another person?',{hint:'Include who told you and when.',pl:'Information reported by others'});
const OUT=(l='Outcome')=>ta('outcome',l,{rows:2,pl:'Outcome'});
const FOLLOW=ta('followup','Follow-up',{rows:2,ph:'Anything still to do, request, or confirm',pl:'Follow-up'});
const T_TITLE=f('title','Custom title','text',{ph:'Leave blank for an automatic title'});
const T_REP=f('reporter','Person preparing this record','text',{ph:'Your name'});
const T_BASIS=chips('basis','How do you know this?',['Saw or heard it myself','Was personally involved','Told by someone else','From a document or recording','A mix of these']);
const T_CASE=f('caseNumber','Court case number(s)','text',{ph:'Leave blank if none',hint:'Separate more than one with commas.'});
const T_CTYPE=chips('caseType','Type of case',['Family','Criminal','Civil protection order','Criminal protection order','Other']);
const T_REL=f('related','Related record IDs','text',{ph:'e.g. INCD004, EVID002',hint:'Codes of other documents this connects to.'});
const WORDING=chips('wording','Wording in generated documents',['Event','Occurrence','Episode','Interaction','Situation','Matter'],{hint:'Optional. Event is neutral; Occurrence is formal; Episode fits a described pattern; Interaction fits an exchange; Situation is softer; Matter fits a formal subject.'});
const tail=(...skip)=>[WORDING,T_TITLE,T_REP,T_BASIS,T_CASE,T_REL].filter(x=>!skip.includes(x.k));
const META=new Set(['title','date','time','timeAcc','location','people','children','reporter','basis','caseNumber','caseType','related']);
const KEEP=new Set([...META,'narrative','observed','reported','quotes','outcome','followup']);
const join=(...p)=>p.filter(Boolean).join(' — ');

/* ---------- categories ---------- */
const GROUPS=[
 {g:'INC',label:'Incident',icon:'📝',desc:'An event or concerning occurrence',leaf:'INC'},
 {g:'PAR',label:'Parenting Issue',icon:'🗓️',desc:'Schedule, parenting time, decisions',leaf:'PAR'},
 {g:'EVD',label:'Evidence',icon:'📎',desc:'Identify a photo, file, or item',leaf:'EVD'},
 {g:'PPD',label:'Police Contact',icon:'🚓',desc:'Calls, responses, reports',leaf:'PPD'},
 {g:'COMMS',label:'Communications',icon:'💬',desc:'Child contact and exchanges',subs:['KCT','EXC'],ask:'What kind of communication?'},
 {g:'FINS',label:'Financial',icon:'💵',desc:'Payments and money matters',subs:['FINPAY','FINMAT'],ask:'What are you recording?'},
 {g:'CRT',label:'Court / Legal',icon:'⚖️',desc:'Hearings, orders, filings',leaf:'CRT'},
 {g:'CARE',label:'Child & Care',icon:'🧸',desc:'Health, school, care, statements',subs:['MED','EDU','THR','ACT','WEL','OBS'],ask:'What is this about?'}
];
const PDFCOLOR={INC:'#a2455f',PAR:'#2f7f73',EVD:'#5c6875',PPD:'#b0573d',COMMS:'#3a6d9a',FINS:'#a8752c',CRT:'#3f4a7c',CARE:'#765a8f'};
const KCT_M=['Phone call','Video call','Text message','Messaging app','Email','In person','Attempted contact'];
const KCT_H={'Phone call':'PHONE CALLS','Video call':'VIDEO CALLS','Text message':'TEXT MESSAGES','Messaging app':'MESSAGING APP','Email':'EMAIL','In person':'IN-PERSON CONTACT','Attempted contact':'ATTEMPTED CONTACT'};
const withKids=(base,v)=>base+(v.children?` — ${v.children}`:'');

const TYPES={
INC:{prefix:'INCD',group:'INC',label:'Incident',heading:v=>(v.wording||'Event').toUpperCase(),seq:true,req:['date','narrative'],account:'Account of events',
 ess:[ta('narrative','What happened?',{tall:1,ph:'Describe what you saw, heard, or were told.',pl:'Account of events'}),DATE('Date it happened'),TIME()],
 more:[T_TITLE,chips('incType','Type of incident',['Safety concern','Unwanted contact','Disagreement','Property damage','Other']),LOC(),PEOPLE(),QUOTES,f('witnesses','Witnesses','text',{ph:'Names'}),ta('effects','Injuries or damage',{rows:2,pl:'Observable effects'}),OUT('What happened afterward?'),FOLLOW,...tail('title')],
 auto:v=>v.incType||String(v.narrative||'Incident').trim().split(/\s+/).slice(0,9).join(' ')},
PAR:{prefix:'PAR',group:'PAR',label:'Parenting Issue',heading:()=>'PARENTING ISSUE',seq:true,req:['date','narrative'],account:'Account',
 ess:[chips('parType','What kind of issue?',['Parenting-time schedule dispute','Requested schedule change','Missed or denied parenting time','Decision-making issue','Healthcare information issue','School information issue','Parenting agreement','Other'],{pl:'Issue type'}),
  CHILD,DATE(),ta('narrative','What happened?',{ph:'What was supposed to happen, and what actually happened.',pl:'What occurred'})],
 more:[TIME(),chips('arrSource','Where does the arrangement come from?',['Court order','Written agreement','Parenting app message','Verbal agreement','Other'],{pl:'Source of arrangement'}),
  QUOTES,OUT(),FOLLOW,...tail()],
 auto:v=>withKids(v.parType||'Parenting issue',v)},
KCT:{prefix:'COMM',group:'COMMS',label:'Communication',sub:'Calls, texts, emails, or conversations',icon:'📱',req:['date'],account:'Communication',
 heading:v=>'COMMUNICATIONS / '+(KCT_H[v.method]||'CONTACT'),
 ess:[chips('method','How was the contact made?',KCT_M,{pl:'Communication method'}),chips('status','Did the contact go through?',['Completed','Attempted','No answer','Interrupted','Declined','Other'],{pl:'Contact status'}),
  DATE(),TIME(),CHILD,
  f('duration','How long did it last?','text',{ph:'e.g. 12 minutes',when:v=>['Phone call','Video call'].includes(v.method)&&!['No answer','Attempted','Declined'].includes(v.status)}),
  ta('narrative','What was said or sent?',{rows:2,ph:'A short summary is fine.',pl:'Summary of what was communicated'})],
 more:[PEOPLE(),f('initiator','Who started the contact?'),QUOTES,FOLLOW,...tail()],
 auto:v=>(v.method||'Communication')+(v.children?` with ${v.children}`:'')+(v.status&&v.status!=='Completed'?` (${v.status.toLowerCase()})`:'')},
EXC:{prefix:'EXC',group:'COMMS',label:'Parenting Exchange',sub:'Pickups, drop-offs, handoffs',icon:'🚗',req:['date'],account:'Exchange account',
 heading:()=>'COMMUNICATIONS / PARENTING EXCHANGE',
 ess:[chips('excType','Type of exchange',['Pickup','Drop-off','Handoff','Other']),
  chips('excStatus','How did it go?',['Completed','Delayed','Changed by agreement','Attempted','Did not occur','Disputed'],{pl:'Exchange status'}),
  DATE(),f('schedTime','Scheduled time','time'),f('actualTime','Actual time','time'),LOC('Exchange location'),CHILD],
 more:[f('present','Who was there?','text',{ph:'Names'}),ta('narrative','Notes',{rows:2,ph:'Only if something differed from what was expected.',pl:'Notes'}),QUOTES,FOLLOW,...tail()],
 auto:v=>join(v.excType||'Parenting exchange',v.excStatus)},
PPD:{prefix:'POLI',group:'PPD',label:'Police Contact',heading:()=>'POLICE INTERACTION',req:['date','narrative'],account:'Account of the interaction',
 ess:[DATE(),TIME('Time police were contacted'),
  chips('contactMethod','How were police contacted?',['911','Non-emergency dispatch','Officer at scene','Station visit','Written or online request','Other'],{pl:'How police were contacted'}),
  ta('narrative','What happened?',{ph:'Why police were contacted, what was said, and what officers did.',pl:'Summary of the interaction'}),
  f('reportNo','Police report number','text',{ph:'If you were given one',hint:'The official number from the agency. This document\'s own code (POLI…) is separate.'})],
 more:[LOC(),f('agency','Police department or agency','text',{ph:'e.g. Pueblo Police Department'}),f('officers','Officers and badge numbers'),
  f('arrivalTime','Time officers arrived','time'),f('cadNo','CAD or dispatch number'),
  ta('outcome','Outcome',{rows:2,hint:'Only what officers actually said or did — e.g. "No report taken."',pl:'Outcome / disposition'}),
  chips('recordsReq','Records request',['Not requested','Requested','Received','Denied']),FOLLOW,...tail()],
 auto:v=>join('Police contact',v.contactMethod)},
EVD:{prefix:'EVID',group:'EVD',label:'Evidence',heading:()=>'EVIDENCE',req:['date','narrative'],account:'Evidence description',files:'evidence',
 ess:[chips('evType','Type of evidence',['Photograph','Screenshot','Audio','Video','PDF','Written document','Message export','Receipt','Physical evidence reference','Other']),
  ta('narrative','Describe the evidence',{rows:2,ph:'What it is and what it shows.',pl:'Description'}),
  chips('evStatus','Preservation status',['Preserved, confirmed','Received, awaiting verification','Held by another person or agency','Requested, not yet received','Existence unconfirmed']),
  DATE('Date received')],
 more:[f('dateCreated','Date created, if known','date'),f('source','Where it came from','text',{ph:'Who provided it, and from what device or account'}),
  f('storage','Where the original is stored','text',{ph:'e.g. USB drive in desk, Google Drive folder'}),
  ta('handling','Handling notes',{rows:2,ph:'Copies made, who has had it'}),...tail('basis')],
 auto:v=>(v.evType||'Evidence item')},
CRT:{prefix:'CRT',group:'CRT',label:'Court / Legal',heading:()=>'COURT / LEGAL',req:['date','docType'],account:'Summary',
 ess:[chips('docType','Document or event type',['Court order','Motion','Petition or filing','Hearing','Notice','Judgment','Other']),
  chips('proceeding','Proceeding type',['Family','Criminal','Civil protection order','Criminal protection order','Other']),
  f('caseNumber','Case number(s)','text',{ph:'e.g. 26DR1234',hint:'Separate more than one case with commas.'}),DATE('Court or hearing date'),
  ta('narrative','What does it say, or what happened?',{rows:2,pl:'Summary'})],
 more:[f('court','Court and county'),f('filingDate','Filing date','date'),
  f('deadline','Verified deadline','date',{hint:'Only a deadline you have confirmed. Add where it comes from below.'}),f('deadlineSource','Where the deadline comes from','text',{ph:'e.g. Order dated 11/3, page 2'}),
  ta('nextAction','Status or next step',{rows:2}),...tail('caseNumber','basis')],
 auto:v=>join(v.docType||'Court record',v.caseNumber&&('Case '+v.caseNumber))},
MED:{prefix:'MED',group:'CARE',label:'Medical & Health',sub:'Appointments, health updates, care',icon:'🩺',heading:()=>'MEDICAL & HEALTH',req:['date'],account:'Details',
 ess:[CHILD,chips('medType','Type of record',['Appointment','Health update','Treatment or medication','Records request','Urgent or emergency care','Insurance or coverage','Other']),DATE(),
  f('provider','Provider or clinic'),ta('narrative','What happened or what was shared?',{rows:2,pl:'Health update'})],
 more:[FOLLOW,...tail()],
 auto:v=>withKids(join(v.medType||'Medical record',v.provider),v)},
EDU:{prefix:'EDU',group:'CARE',label:'Education',sub:'School notices, meetings, progress',icon:'📚',heading:()=>'EDUCATION',req:['date'],account:'Details',
 ess:[CHILD,f('school','School'),chips('eduType','Type of school event',['School notice','Parent-teacher meeting','Attendance','Grades or progress','IEP or 504 plan','Discipline notice','School event','Other']),DATE(),
  ta('narrative','What happened?',{rows:2,pl:'Details'})],
 more:[f('notified','How was the parent notified?','text',{ph:'e.g. Email from teacher on 11/3',pl:'Parent notification'}),FOLLOW,...tail()],
 auto:v=>withKids(join(v.eduType||'School record',v.school),v)},
THR:{prefix:'THR',group:'CARE',label:'Therapy & Counseling',sub:'Referrals, appointments, consent',icon:'🧠',heading:()=>'THERAPY & COUNSELING',req:['date'],account:'Details',
 banner:'Record scheduling and participation only. Don\'t include private session content, and respect any confidentiality rules or court orders.',
 ess:[CHILD,chips('thrType','Type of therapy or counseling',['Individual therapy','Family counseling','Parent-child session','Evaluation or assessment','Referral','Other']),
  f('provider','Provider'),DATE('Appointment date'),ta('narrative','Scheduling or participation details',{rows:2,pl:'Scheduling and participation'})],
 more:[chips('consent','Consent or authorization',['Given','Requested','Not given','Not required','Unknown']),FOLLOW,...tail()],
 auto:v=>withKids(join(v.thrType||'Therapy or counseling',v.provider),v)},
ACT:{prefix:'ACT',group:'CARE',label:'Activities',sub:'Sports, clubs, events',icon:'🏅',heading:()=>'ACTIVITIES & EXTRACURRICULARS',req:['date','activity'],account:'Details',
 ess:[CHILD,f('activity','Activity','text',{ph:'e.g. Soccer practice'}),DATE(),chips('participation','Participation',['Attended','Missed','Left early','Cancelled','Other'])],
 more:[ta('narrative','Notes',{rows:2,ph:'Transportation, who was notified, anything else',pl:'Notes'}),LOC(),...tail()],
 auto:v=>withKids(join(v.activity||'Activity',v.participation),v)},
WEL:{prefix:'WEL',group:'CARE',label:'Daily Care & Well-Being',sub:'Routines, meals, care given',icon:'🌿',heading:()=>'DAILY CARE & WELL-BEING',req:['date'],account:'Care details',
 ess:[CHILD,DATE(),chips('careType','Care activity',['Meals','Sleep or bedtime','Hygiene','Homework','Medication given','Transportation','Supplies or clothing','Other']),
  ta('narrative','Notes',{rows:2,ph:'Optional',pl:'Care provided'})],
 more:[f('caregiver','Caregiver'),FOLLOW,...tail()],
 auto:v=>withKids(v.careType||'Daily care',v)},
OBS:{prefix:'OBS',group:'CARE',label:'Child Statements & Observations',sub:'Things a child said or did',icon:'👀',heading:()=>'CHILD STATEMENTS & OBSERVATIONS',req:['date','obsKind'],account:'Statement or observation',
 banner:'Write down what the child said or did on their own. Don\'t question the child repeatedly, and never ask a child to gather information.',
 ess:[CHILD,DATE(),TIME(),chips('obsKind','What are you recording?',['Exact words the child said','What the child said, in my words','Behavior I observed'],{pl:'Record type'}),
  ta('exact','Exact words',{hint:'Only if you are confident of the wording — word for word.',pl:'Exact statement (recalled word for word)',when:v=>v.obsKind==='Exact words the child said'}),
  ta('paraphrase','What the child said, in your words',{pl:'Paraphrase (not exact wording)',when:v=>v.obsKind==='What the child said, in my words'}),
  ta('behavior','What you observed',{hint:'Describe actions you saw or heard, without guessing reasons.',pl:'Personally observed behavior',when:v=>v.obsKind==='Behavior I observed'})],
 more:[ta('narrative','What was happening just before?',{rows:2,pl:'Circumstances'}),LOC(),f('present','Who else was there?','text',{pl:'People present'}),ta('after','What happened afterward?',{rows:2,pl:'Subsequent actions'}),...tail()],
 check:v=>{const map={'Exact words the child said':'exact','What the child said, in my words':'paraphrase','Behavior I observed':'behavior'};const k=map[v.obsKind];return k&&!(v[k]||'').trim()?k:null},
 auto:v=>withKids(v.obsKind==='Behavior I observed'?'Observed behavior':v.obsKind==='Exact words the child said'?'Child statement (exact words)':v.obsKind?'Child statement (paraphrase)':'Child observation',v)},
FINPAY:{prefix:'FIN',group:'FINS',label:'Payment / Expense',sub:'A payment that was made, due, or disputed',icon:'💳',fin:'pay',heading:()=>'PAYMENT / EXPENSE',req:['title','date','amount'],files:'receipts',
 ess:[f('title','What was it for?','text',{ph:'e.g. November car insurance'}),DATE('Payment date'),f('amount','Amount','money',{ph:'0.00'}),
  f('paidBy','Who paid?'),f('paidTo','Who received the payment?'),
  chips('payCat','Category',['Child support','Vehicle payment','Auto insurance','Medical or dental','School','Childcare','Therapy','Legal or court fees','Transportation','Other']),
  chips('payStatus','Status',['Paid, confirmation available','Reported paid, proof pending','Due or scheduled','Requested','Disputed','Not paid']),
  chips('payMethod','How was it paid?',['Cash','Debit or credit card','Bank transfer','Check','Payment app','Money order','Payroll deduction','Other'])],
 more:[f('txn','Receipt or transaction number','text',{hint:'The number printed on the receipt or confirmation — not the RCP code.'}),
  ta('narrative','Notes',{rows:2,pl:'Notes'}),T_CASE,T_REL]},
FINMAT:{prefix:'FIN',group:'FINS',label:'Financial Matter',sub:'A request, proposal, discussion, or agreement',icon:'🗨️',fin:'matter',heading:()=>'FINANCIAL MATTER',req:['title','date'],files:'receipts',
 ess:[f('title','Subject','text',{ph:'e.g. Request to split dental bill'}),DATE(),f('amount','Amount, if any','money',{ph:'0.00'}),
  f('raisedBy','Who raised it?'),chips('matStatus','Current status',['Discussed only','Requested','Proposed, not agreed','Agreed, as reported','Disputed','Resolved']),
  ta('narrative','What was discussed or requested?',{rows:2,pl:'What was discussed or requested'})],
 more:[WORDING,f('participants','Other participants'),T_CASE,T_REL]}
};
const GROUP_OF=k=>TYPES[k]?.group;
const PREFIX_NAMES={INCD:'Incident',PAR:'Parenting Issue',EVID:'Evidence',POLI:'Police Contact',COMM:'Communication',EXC:'Parenting Exchange',FIN:'Financial',RCP:'Receipts (RCP)',CRT:'Court / Legal',MED:'Medical & Health',EDU:'Education',THR:'Therapy & Counseling',ACT:'Activities',WEL:'Daily Care',OBS:'Child Statements',COM:'Communications (older code)',CHD:'Child & Care (older code)'};
const PREFIXES=Object.keys(PREFIX_NAMES);

/* ---------- counters (only thing stored) ---------- */
let storageOK=true;
let counters=Object.fromEntries(PREFIXES.map(p=>[p,1]));
function syncCounters(){const c=window.App&&App.counters?App.counters():{};for(const p of PREFIXES)counters[p]=Math.max(counters[p]||1,Number(c[p])||1)}
function persist(){if(window.App&&App.saveCounters)App.saveCounters({...counters})}
const code=p=>p+pad(counters[p]);

/* ---------- state (memory only) ---------- */
let typeKey=null, activeGroup=null, vals={}, files=[], moments=[], doc=null, touched=false, entryStarted=null, uid=0;
const whenList=[];
function markStarted(){touched=true;if(!entryStarted)entryStarted=new Date().toISOString();refreshSteps()}
const T=()=>TYPES[typeKey];
const allFields=()=>[...T().ess,...T().more];
const visibleFields=()=>allFields().filter(fd=>!fd.when||fd.when(vals));
const dirty=()=>touched||files.length>0||moments.some(m=>m.detail.trim());

/* ---------- category UI ---------- */
function renderCards(){const box=$('cards');box.innerHTML='';
 for(const G of GROUPS){box.append(h('button',{type:'button',class:'card','data-g':G.g,'aria-pressed':String(activeGroup===G.g),onclick:()=>pickGroup(G)},
  h('span',{class:'badge'},'✓ Selected'),h('span',{class:'ico','aria-hidden':'true'},G.leaf?TYPES[G.leaf].prefix:G.label.slice(0,3).toUpperCase()),h('span',{class:'lbl'},G.label),h('span',{class:'desc'},G.desc)))}
 const G=GROUPS.find(x=>x.g===activeGroup);
 if(G&&G.subs){$('subs').classList.remove('hidden');$('subs').dataset.g=G.g;$('subsTitle').textContent=G.ask;const sg=$('subgrid');sg.innerHTML='';
  for(const k of G.subs){const t=TYPES[k];sg.append(h('button',{type:'button',class:'sub','aria-pressed':String(typeKey===k),onclick:()=>selectType(k)},
   h('span',{class:'ico','aria-hidden':'true'},t.prefix),h('span',{},h('strong',{},t.label),h('span',{class:'s'},`${t.sub} · numbered ${t.prefix}001, ${t.prefix}002…`))))}}
 else $('subs').classList.add('hidden');
 const show=!!typeKey&&GROUP_OF(typeKey)===activeGroup;
 $('describe').classList.toggle('hidden',!show);$('create').classList.toggle('hidden',!show);$('pickFirst').classList.toggle('hidden',show||!!(G&&G.subs));
 if(G&&G.subs&&!show)$('pickFirst').classList.add('hidden');
 refreshSteps();
}
async function pickGroup(G){if(G.leaf){if(await selectType(G.leaf)===false)return}else{activeGroup=G.g;renderCards();}}
async function selectType(k){
 if(k===typeKey){$('categoryPicker').open=false;activeGroup=GROUP_OF(k);renderCards();return true}
 if(typeKey){
  const specific=Object.keys(vals).filter(x=>!KEEP.has(x)&&String(vals[x]||'').trim());
  if(doc&&!(await ask('Switch record type?',`This record already has the number ${doc.id}. Switching type starts a new record with a different number. The ${doc.id} PDF you made is not affected.`))){activeGroup=GROUP_OF(typeKey);renderCards();return false}
  if(!doc&&specific.length&&!(await ask('Switch record type?','Switching type removes answers that only apply to the current type. Shared answers like the date and description stay.'))){activeGroup=GROUP_OF(typeKey);renderCards();return false}
  for(const x of specific)delete vals[x];
  doc=null;files.forEach(fl=>fl.ref=null);
 }
 $('categoryPicker').open=false;typeKey=k;activeGroup=GROUP_OF(k);if(!vals.date)vals.date=today();
 renderCards();renderForm();
 const target=$('describe');requestAnimationFrame(()=>target.scrollIntoView({behavior:reduced()?'auto':'smooth',block:'start'}));
 return true;
}

/* ---------- form UI ---------- */
function fieldEl(fd,inMore){
 const isReq=T().req.includes(fd.k);
 const wide=fd.t==='textarea'||fd.t==='chips'||fd.t==='timeacc';
 const wrap=h('div',{class:'field'+(wide?' full':''),'data-k':fd.k});
 const id='f_'+fd.k;const errId='e_'+fd.k;const hintId='h_'+fd.k;
 const req=isReq?h('span',{class:'req'},'* required'):null;
 const described=[fd.hint?hintId:null,errId].filter(Boolean).join(' ');
 if(fd.t==='chips'){
  const lid='l_'+fd.k;wrap.append(h('div',{class:'glabel',id:lid},fd.l,req));
  const g=h('div',{class:'chips',role:'group','aria-labelledby':lid,'aria-describedby':described});
  for(const o of fd.o){g.append(h('button',{type:'button',class:'opt','aria-pressed':String(vals[fd.k]===o),onclick:e=>{vals[fd.k]=vals[fd.k]===o?'':o;g.querySelectorAll('.opt').forEach(c=>c.setAttribute('aria-pressed',String(vals[fd.k]===c.textContent)));clearErr(fd.k);markStarted();refreshWhen();updateMoreHint();$('typeChip').textContent=T().heading(vals)}},o))}
  wrap.append(g);
 }else if(fd.t==='timeacc'){
  wrap.append(h('label',{for:id},fd.l,h('span',{style:'font-weight:450;color:var(--muted)'},' (leave blank if unknown)')));
  const inp=h('input',{id,type:'time',value:vals.time||'','aria-describedby':described});
  const accG=h('div',{class:'chips',role:'group','aria-label':'How accurate is the time?'});
  const syncAcc=()=>{const eff=vals.time?(vals.timeAcc||'Exact'):'Unknown';accG.querySelectorAll('.opt').forEach(c=>{c.setAttribute('aria-pressed',String(c.dataset.v===eff));c.disabled=!vals.time&&c.dataset.v!=='Unknown'})};
  inp.addEventListener('input',()=>{vals.time=inp.value;if(!vals.time)vals.timeAcc='';markStarted();syncAcc()});
  for(const[v,lbl] of [['Exact','Exact'],['Approximate','Approximate'],['Unknown','Unknown']]){accG.append(h('button',{type:'button',class:'opt','data-v':v,onclick:()=>{if(v==='Unknown'){vals.time='';inp.value='';vals.timeAcc=''}else vals.timeAcc=v;markStarted();syncAcc()}},lbl))}
  const now=h('button',{type:'button',class:'btn small soft',onclick:()=>{const d=new Date();vals.time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;vals.timeAcc='Exact';inp.value=vals.time;markStarted();syncAcc()}},'Now');
  wrap.append(h('div',{class:'timerow'},inp,now,accG));syncAcc();
 }else{
  wrap.append(h('label',{for:id},fd.l,req));
  let el;
  if(fd.t==='textarea'){el=h('textarea',{id,rows:fd.rows||4,class:fd.tall?'tall':fd.rows===2?'r2':null,placeholder:fd.ph||null,'aria-describedby':described});el.value=vals[fd.k]||''}
  else{const type=fd.t==='money'?'text':fd.t;el=h('input',{id,type,placeholder:fd.ph||null,'aria-describedby':described,inputmode:fd.t==='money'?'decimal':null,maxlength:fd.k==='title'?'180':null});el.value=vals[fd.k]||''}
  if(isReq)el.setAttribute('aria-required','true');
  el.addEventListener('input',()=>{vals[fd.k]=el.value;clearErr(fd.k);markStarted();if(inMore)updateMoreHint()});
  wrap.append(el);
 }
 if(fd.hint)wrap.append(h('div',{class:'hint',id:hintId},fd.hint));
 wrap.append(h('div',{class:'err',id:errId,'aria-live':'polite'}));
 if(fd.when)whenList.push({el:wrap,fd});
 return wrap;
}
function refreshWhen(){for(const{el,fd} of whenList)el.classList.toggle('hidden',!fd.when(vals))}
function renderForm(){
 const t=T();const g=t.group;
 $('describe').dataset.g=g;$('create').dataset.g=g;$('subs').dataset.g=g;
 $('typeChip').textContent=t.heading(vals);$('categoryName').textContent=t.label;
 whenList.length=0;
 const ess=$('essentials');ess.innerHTML='';
 if(t.banner)ess.append(h('div',{class:'banner',role:'note'},t.banner));
 t.ess.forEach(fd=>ess.append(fieldEl(fd,false)));
 const mf=$('moreFields');mf.innerHTML='';t.more.forEach(fd=>mf.append(fieldEl(fd,true)));
 $('seqBlock').classList.toggle('hidden',!t.seq);if(!t.seq)moments=[];renderMoments();
 const fb=$('filesBlock');const kind=t.files||'support';
 fb.classList.toggle('prominent',kind!=='support');
 $('filesTitle').textContent=kind==='evidence'?'Evidence files':kind==='receipts'?'Receipts or payment proof':'Supporting evidence';
 $('fileBtnText').textContent=kind==='receipts'?'＋ Add receipts':'Attach evidence';
 $('filesNote').textContent=kind==='receipts'?'Each receipt gets its own RCP number. The original file stays on your device and is not put inside the PDF — keep it.':'Add a photo, screenshot, document, or recording. Ridion links the file to this record.';
 renderFiles();refreshWhen();updateMoreHint();updateStatus();
}
function updateMoreHint(){
 const t=T();const filled=t.more.filter(fd=>String(vals[fd.k]||'').trim()&&(!fd.when||fd.when(vals))).length+moments.filter(m=>m.detail.trim()).length;
 const names=t.more.slice(0,3).map((fd,i)=>{const l=fd.l.replace(/\?$/,'').replace(/, if known$/,'');return i?l.charAt(0).toLowerCase()+l.slice(1):l}).join(', ');
 $('moreHint').textContent=(filled?`${filled} filled · `:'')+names+'…';
}

/* ---------- moments ---------- */
const BASIS=['Saw or heard it myself','Told by someone else','From a document or recording','Not sure'];
function renderMoments(){const host=$('seqList');host.innerHTML='';
 moments.forEach((m,i)=>{
  const tIn=h('input',{type:'text',value:m.when,placeholder:'Time or order, e.g. 6:40 PM or "after the call"','aria-label':`Moment ${i+1}: time or order`});
  const dIn=h('textarea',{placeholder:'What happened at this point?','aria-label':`Moment ${i+1}: what happened`});dIn.value=m.detail;
  const sel=h('select',{'aria-label':`Moment ${i+1}: how you know`},...BASIS.map(b=>h('option',{value:b},b)));sel.value=m.basis;
  tIn.addEventListener('input',()=>{m.when=tIn.value;markStarted()});dIn.addEventListener('input',()=>{m.detail=dIn.value;markStarted();updateMoreHint()});sel.addEventListener('change',()=>{m.basis=sel.value});
  host.append(h('div',{class:'moment'},tIn,dIn,h('div',{class:'row'},sel,h('button',{type:'button',class:'btn small',onclick:()=>{moments.splice(i,1);renderMoments();updateMoreHint()}},'Remove'))));
 });
}

/* ---------- files ---------- */
const MAXHASH=150*1048576;
async function hashFile(it){
 if(!(window.crypto&&crypto.subtle)){it.note='Not calculated — this browser only allows it on a secure (https) page';return}
 if(it.size>MAXHASH){it.note='Not calculated — file is larger than 150 MB';return}
 try{const d=await crypto.subtle.digest('SHA-256',await it.file.arrayBuffer());it.hash=[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');it.note=''}
 catch{it.note='Not calculated — the file could not be read'}
}
function addFiles(list){for(const file of list){const it={uid:++uid,file,name:file.name,size:file.size,type:file.type||'Unknown type',lastModified:file.lastModified?new Date(file.lastModified).toISOString():null,hash:'',note:'Calculating fingerprint…',ref:null};files.push(it);it.pending=hashFile(it).then(()=>{renderFiles();updateStatus()})}markStarted();renderFiles();updateStatus()}
function renderFiles(){
 const host=$('fileList');host.innerHTML='';if(!typeKey)return;const p=plan();
 files.forEach((it,i)=>{
  const ref=it.ref||p.refs.get(it.uid);
  host.append(h('div',{class:'fileitem'},h('div',{},
   h('span',{class:'ref'},it.ref?ref:`${ref} · assigned when you create the document`),
   h('div',{class:'nm'},it.name),h('div',{class:'meta'},`${fmtSize(it.size)} · ${it.type}`),
   h('div',{class:'meta'},it.hash?['SHA-256: ',h('code',{},it.hash)]:it.note)),
   h('button',{type:'button',class:'btn small','aria-label':'Remove '+it.name,onclick:()=>{files.splice(i,1);renderFiles();updateStatus()}},'Remove')));
 });
 const noCrypto=!(window.crypto&&crypto.subtle);
 $('hashWarn').classList.toggle('hidden',!noCrypto);$('hashWarn').textContent=noCrypto?'File fingerprints (SHA-256) need a secure page. Open this file from your device or an https address to get them.':'';
}

/* ---------- numbering plan / commit ---------- */
function fingerprint(){const v={};for(const fd of visibleFields()){if(fd.t==='timeacc'){v.time=vals.time||'';v.timeAcc=vals.timeAcc||''}else v[fd.k]=String(vals[fd.k]||'').trim()}
 return JSON.stringify([typeKey,v,moments.map(m=>[m.when,m.detail,m.basis]),files.map(x=>[x.name,x.size,x.hash])])}
function plan(){
 syncCounters();const t=T();const isNew=!doc;const id=doc?doc.id:code(t.prefix);const fp=fingerprint();
 const revision=isNew?1:(fp===doc.fp?doc.revision:doc.revision+1);
 let rc=counters.RCP,seq=doc?doc.fileSeq:0;
 let ev=counters.EVID+(isNew && t.prefix==='EVID'?1:0);
 const refs=new Map(), byHash=new Map();
 for(const it of files){if(it.ref){refs.set(it.uid,it.ref);continue}const existing=it.hash&&(byHash.get(it.hash)||window.App?.attachmentCode(it.hash));
 const ref=existing||(t.fin?'RCP'+pad(rc++):'EVID'+pad(ev++));
 refs.set(it.uid,ref);if(it.hash)byHash.set(it.hash,ref)}
 return {isNew,id,fp,revision,refs,rcpNext:rc,evidenceNext:ev,fileSeq:seq,prefix:t.prefix};
}
function commit(p,method){
 if(p.isNew){const n=Number(p.id.replace(/^\D+/,''));counters[p.prefix]=Math.max(counters[p.prefix],n+1)}
 counters.EVID=Math.max(counters.EVID,p.evidenceNext);counters.RCP=Math.max(counters.RCP,p.rcpNext);persist();
 for(const it of files)it.ref=p.refs.get(it.uid);
 doc={id:p.id,prefix:p.prefix,revision:p.revision,fp:p.fp,fileSeq:p.fileSeq,method,at:new Date().toISOString()};
 renderFiles();updateStatus();
}

/* ---------- collect record (manifest) ---------- */
function collect(p,output){
 const t=T();const vis=visibleFields();const v=k=>String(vals[k]||'').trim();
 const shown=new Set(vis.map(fd=>fd.t==='timeacc'?'time':fd.k));const g=k=>shown.has(k)?v(k):'';
 const fields=[],narrative=[];
 for(const fd of vis){if(META.has(fd.k)||fd.t==='timeacc')continue;const val=v(fd.k);if(!val)continue;
  if(fd.t==='textarea')narrative.push({key:fd.k,label:fd.pl||fd.l,value:val});
  else fields.push({key:fd.k,label:fd.pl||fd.l.replace(/\?$/,''),value:fd.t==='date'?fmtDate(val):fd.t==='time'?fmtTime(val):fd.t==='money'?money(val):val,raw:val});}
 let eventTime=g('time'),timeAccuracy=shown.has('time')?(eventTime?(vals.timeAcc||'Exact'):'Unknown'):'';
 if(typeKey==='EXC'){eventTime=v('actualTime')||v('schedTime');timeAccuracy=eventTime?'Exact':'Unknown'}
 const caseNums=g('caseNumber').split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
 const proceeding=g('caseType')||(typeKey==='CRT'?v('proceeding'):'');
 const fileRows=files.map(it=>({ref:p.refs.get(it.uid),role:t.fin?'receipt':'evidence',name:it.name,size:it.size,mime:it.type,lastModified:it.lastModified,sha256:it.hash||null,hashNote:it.hash?'':it.note,originalIncluded:false}));
 const title=g('title')||(t.auto?t.auto(vals):'')||t.label;
 return {
  id:p.id,prefix:t.prefix,number:Number(p.id.replace(/^\D+/,'')),typeKey,category:GROUPS.find(G=>G.g===t.group).label,subcategory:t.label,heading:typeKey==='INC'?(vals.wording||'Event').toUpperCase():t.heading(vals),
  title,titleAutomatic:!g('title'),eventDate:v('date'),eventTime,timeAccuracy,timeZone:TZ,
  entryStarted:entryStarted||new Date().toISOString(),generatedAt:new Date().toISOString(),revision:p.revision,isNew:p.isNew,output,
  preparedBy:g('reporter'),basis:g('basis'),location:g('location'),
  people:g('people').split(/\n+/).map(s=>s.trim()).filter(Boolean),children:g('children').split(/,|\band\b|&/).map(s=>s.trim()).filter(Boolean),
  peopleText:g('people'),childrenText:g('children'),
  caseRefs:caseNums.map(n=>({caseNumber:n,proceeding})),caseType:proceeding,
  relatedIds:g('related').split(/[,;\s]+/).map(s=>s.trim().toUpperCase()).filter(Boolean),
  fields,narrative,sequence:t.seq?moments.filter(m=>m.detail.trim()||m.when.trim()).map(m=>({when:m.when.trim(),description:m.detail.trim(),basis:m.basis})):[],
  files:fileRows,receiptRefs:t.fin?fileRows.map(x=>x.ref):[],evidenceRefs:t.fin?[]:fileRows.map(x=>x.ref),
  financial:t.fin?{kind:t.fin==='pay'?'payment':'matter',amount:v('amount')===''?null:Number(v('amount')),amountText:v('amount'),paidBy:g('paidBy'),paidTo:g('paidTo'),category:g('payCat'),status:g('payStatus')||g('matStatus'),method:g('payMethod'),merchantReceiptNumber:g('txn'),raisedBy:g('raisedBy'),participants:g('participants')}:null
 };
}
function manifest(rec){const r={...rec};delete r.isNew;delete r.peopleText;delete r.childrenText;delete r.typeKey;r.fields=rec.fields.map(({key,label,raw})=>({key,label,value:raw}));return {schema:'documentation-record',schemaVersion:2,record:r}}

/* ---------- document model (shared by preview, print, PDF) ---------- */
function daysBetween(a,b){const x=parseD(a),y=new Date(b);if(!x)return null;const yy=new Date(y.getFullYear(),y.getMonth(),y.getDate());return Math.round((yy-x)/86400000)}
function buildModel(rec,mode){
 const t=TYPES[rec.typeKey];const term=Lib.recordTerm(rec);const m={accent:PDFCOLOR[t.group],kicker:'DOCUMENTATION / '+monthYear(rec.eventDate),heading:rec.heading,title:rec.title,id:rec.id,revision:rec.revision,mode,sections:[],notes:[],banner:null};
 const idShown=mode==='preview'&&rec.isNew?`${rec.id} (next available — assigned when you download or print)`:rec.id;
 m.idLine=`Document ID ${mode==='preview'&&rec.isNew?rec.id+' (not yet assigned)':rec.id}  ·  Revision ${rec.revision}`;
 const revText=rec.revision===1?'1 (original)':`${rec.revision} (corrected version — earlier revisions are unchanged)`;
 const created=mode==='preview'?'Not yet created (preview)':stamp(rec.generatedAt);
 const d=daysBetween(rec.eventDate,rec.entryStarted);
 const timing=d==null?'':d<=0?'Entered the same day as the event':d===1?'Entered 1 day after the event date':`Entered ${d} days after the event date`;
 const timeText=rec.eventTime?`${fmtTime(rec.eventTime)} (${rec.timeAccuracy.toLowerCase()})${rec.timeZone?' — '+rec.timeZone:''}`:(rec.timeAccuracy==='Unknown'?'Unknown':'');
 const caseText=rec.caseRefs.map(c=>c.caseNumber).join(', ');
 const relText=rec.relatedIds.join(', ');
 if(t.fin){
  const F=rec.financial;
  m.sections.push({title:F.kind==='payment'?'Payment entry':'Financial matter',kind:'table',cols:[{h:'Date',w:.17},{h:'Description',w:.43},{h:'Amount',w:.16},{h:'Status',w:.24}],rows:[[fmtDate(rec.eventDate),rec.title,F.amountText?money(F.amountText):'—',F.status||'—']]});
  m.sections.push({title:'Details',kind:'kv',rows:[['Document ID',idShown],['Record type',rec.heading.replace(' / ',' / ')],['Paid by',F.paidBy],['Paid to',F.paidTo],['Category',F.category],['Payment method',F.method],['Receipt / transaction no. (original)',F.merchantReceiptNumber],['Raised by',F.raisedBy],['Other participants',F.participants],['Case number(s)',caseText],['Related records',relText],['Entry started',stamp(rec.entryStarted)],['Document created',created],['Revision',revText]]});
  const notes=rec.narrative.filter(n=>n.value);if(notes.length)m.sections.push({title:F.kind==='payment'?'Notes':'Discussion',kind:'paras',items:notes.map(n=>[n.label,n.value])});
  if(rec.files.length)m.sections.push({title:'Receipts and payment proof',kind:'table',cols:[{h:'Internal ID',w:.17},{h:'Original file',w:.33},{h:'Size / type',w:.18},{h:'SHA-256 fingerprint',w:.32}],rows:rec.files.map(x=>[x.ref+(mode==='preview'&&!files.find(y=>y.ref===x.ref)?' (pending)':''),x.name,`${fmtSize(x.size)}\n${x.mime}`,x.sha256||x.hashNote])});
  m.notes.push('Prepared by the user from their own entries. This is a personal record, not a court document or verified finding.');
  if(F.kind==='payment')m.notes.push('Recording a payment here does not by itself establish how it applies to any court-ordered obligation, including support.');
  else m.notes.push('A recorded discussion, request, or proposal is not by itself a binding agreement.');
  if(rec.files.length)m.notes.push('Internal receipt IDs (RCP) are separate from any number printed on the original receipt. Original files are not contained in this PDF and must be kept separately.');
 }else{
  m.sections.push({title:'Record information',kind:'kv',rows:[['Document ID',idShown],['Document type',rec.heading],[term+' date',fmtDate(rec.eventDate,true)],['Time',timeText],['Location',rec.location],['Child or children',rec.childrenText],['People involved',rec.peopleText],['Prepared by',rec.preparedBy],['How the preparer knows',rec.basis],['Case number(s)',caseText],['Case type',rec.caseType],['Related records',relText],['Entry started',stamp(rec.entryStarted)],['Timing of entry',timing],['Document created',created],['Revision',revText]]});
  if(rec.fields.length)m.sections.push({title:(rec.typeKey==='INC'?term:t.label)+' details',kind:'kv',rows:rec.fields.map(x=>[x.label,x.value])});
  const main=rec.narrative.filter(n=>!['outcome','followup'].includes(n.key));const after=rec.narrative.filter(n=>['outcome','followup'].includes(n.key));
  if(main.length)m.sections.push({title:'Account of the '+term.toLowerCase(),kind:'paras',items:main.map(n=>[n.label,n.value])});
  if(rec.sequence.length)m.sections.push({title:term+' sequence',kind:'seq',items:rec.sequence});
  if(after.length)m.sections.push({title:'Outcome and follow-up',kind:'paras',items:after.map(n=>[n.label,n.value])});
  if(rec.files.length)m.sections.push({title:t.files==='evidence'?'Evidence files':'Supporting file references',kind:'table',cols:[{h:'Reference',w:.18},{h:'Original file',w:.32},{h:'Size / type',w:.18},{h:'SHA-256 fingerprint',w:.32}],rows:rec.files.map(x=>[x.ref,x.name,`${fmtSize(x.size)}\n${x.mime}`,x.sha256||x.hashNote])});
  m.notes.push('Prepared by the user from their own entries. This is a personal record — not a court document, police report, or independent verification.');
  if(rec.typeKey==='PPD')m.notes.push(`${rec.id} is this document's internal number. It is not a police report number.`);
  if(rec.files.length)m.notes.push('Files are listed by reference only. The original files are not contained in this PDF and must be kept separately. A matching SHA-256 fingerprint shows a file has not changed.');
 }
 if(mode==='print')m.notes.push('Printed copy: this PDF does not contain machine-readable record data.');
 if(mode==='pdf')m.notes.push(`This PDF contains machine-readable record data in an attached file named ${rec.id}-record.json.`);
 for(const s of m.sections){if(s.kind==='kv')s.rows=s.rows.filter(r=>String(r[1]||'').trim())}
 return m;
}
function paperHtml(m){
 let o=`<div class="rpaper" style="--pa:${m.accent}"><div class="kick"><span>${esc(m.kicker)}</span><span>${esc(m.mode==='preview'&&m.banner?'PREVIEW':m.id)}</span></div>`;
 o+=`<div class="hd">${esc(m.heading)}</div><h1>${esc(m.title)}</h1><div class="idl">${esc(m.idLine)}</div>`;
 if(m.banner)o+=`<div class="pv">${m.banner}</div>`;
 for(const s of m.sections){
  if(s.kind==='kv'&&!s.rows.length)continue;
  o+=`<h2>${esc(s.title)}</h2>`;
  if(s.kind==='kv')o+='<div class="kv">'+s.rows.map(([k,v])=>`<div class="k">${esc(k)}</div><div>${esc(v)}</div>`).join('')+'</div>';
  if(s.kind==='paras')o+=s.items.map(([k,v])=>`<div class="pl">${esc(k)}</div><div class="pt">${esc(v)}</div>`).join('');
  if(s.kind==='seq')o+=s.items.map(x=>`<div class="sq"><b>${esc(x.when||'Time unknown')}</b> · <span style="color:#55607a">${esc(x.basis)}</span><div class="pt">${esc(x.description)}</div></div>`).join('');
  if(s.kind==='table')o+=`<table><thead><tr>${s.cols.map(c=>`<th style="width:${c.w*100}%">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 }
 o+=`<h2>Notes</h2><div class="notes">${m.notes.map(n=>`<p>${esc(n)}</p>`).join('')}</div></div>`;
 return o;
}

/* ---------- PDF writer (self-contained, US Letter) ---------- */
const HN=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HB=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const WIN={0x20AC:128,0x201A:130,0x0192:131,0x201E:132,0x2026:133,0x2020:134,0x2021:135,0x02C6:136,0x2030:137,0x0160:138,0x2039:139,0x0152:140,0x017D:142,0x2018:145,0x2019:146,0x201C:147,0x201D:148,0x2022:149,0x2013:150,0x2014:151,0x02DC:152,0x2122:153,0x0161:154,0x203A:155,0x0153:156,0x017E:158,0x0178:159};
const WX={128:556,130:222,131:556,132:333,133:1000,134:556,135:556,136:333,137:1000,138:667,139:333,140:1000,142:611,145:222,146:222,147:333,148:333,149:350,150:556,151:1000,152:333,153:1000,154:500,155:333,156:944,158:500,159:667};
function winBytes(s,bad){const out=[];for(const ch of String(s).normalize('NFC')){const c=ch.codePointAt(0);if(c===9){out.push(32,32,32,32);continue}if(c===10||c===13)continue;if(c>=32&&c<=126||c>=160&&c<=255)out.push(c);else if(WIN[c])out.push(WIN[c]);else{if(bad&&!/[​-‍️]/.test(ch))bad.add(ch);if(!/[​-‍️]/.test(ch))out.push(63)}}return out}
function unsupportedIn(strs){const bad=new Set();for(const s of strs)winBytes(s,bad);return [...bad]}
function makePdf(m,rec){
 const W=612,H=792,ML=54,MR=558,CW=MR-ML,TOP=58,BOT=60;
 const hex=x=>[1,3,5].map(i=>(parseInt(x.slice(i,i+2),16)/255).toFixed(3)).join(' ');
 const ACC=hex(m.accent),NAVY='0.122 0.176 0.302',INK='0.110 0.137 0.200',SLATE='0.310 0.353 0.427',LIGHT='0.949 0.957 0.969',RULE='0.851 0.871 0.902';
 const bad=new Set();
 const tw=(s,size,bold)=>{let u=0;const tab=bold?HB:HN;for(const b of winBytes(s)){u+=b>=32&&b<=126?tab[b-32]:(WX[b]||(b>=192&&b<=222?722:bold?611:556))}return u*size/1000};
 const lit=s=>winBytes(s,bad).map(b=>b===40||b===41||b===92?'\\'+String.fromCharCode(b):b<128?String.fromCharCode(b):'\\'+b.toString(8).padStart(3,'0')).join('');
 function wrap(text,max,size,bold){const out=[];for(const para of String(text??'').split(/\r?\n/)){if(!para.trim()){out.push('');continue}let line='';for(let word of para.split(/ +/)){if(!word)continue;while(tw(word,size,bold)>max){let n=1;while(n<word.length&&tw(word.slice(0,n+1),size,bold)<=max)n++;if(line){out.push(line);line=''}out.push(word.slice(0,n));word=word.slice(n)}if(!word)continue;const test=line?line+' '+word:word;if(line&&tw(test,size,bold)>max){out.push(line);line=word}else line=test}if(line)out.push(line)}while(out.length&&out[out.length-1]==='')out.pop();return out.length?out:['']}
 const pages=[];let ops=[],y=0;
 const txt=(s,x,base,size,bold,col)=>ops.push(`BT /F${bold?2:1} ${size} Tf ${col} rg ${x.toFixed(2)} ${(H-base).toFixed(2)} Td (${lit(s)}) Tj ET`);
 const rect=(x,top,w,hh,col)=>ops.push(`${col} rg ${x.toFixed(2)} ${(H-top-hh).toFixed(2)} ${w.toFixed(2)} ${hh.toFixed(2)} re f`);
 const rule=(top,col=RULE,x1=ML,x2=MR)=>ops.push(`${col} RG 0.6 w ${x1} ${(H-top).toFixed(2)} m ${x2} ${(H-top).toFixed(2)} l S`);
 function newPage(){if(ops.length)pages.push(ops);ops=[];rect(0,0,W,6,ACC);txt(m.kicker,ML,30,8,true,ACC);txt(m.id,MR-tw(m.id,9,true),30,9,true,NAVY);rule(40);y=TOP}
 const room=()=>H-BOT-y;
 function ensure(hh){if(hh>room())newPage()}
 function sectionHead(title){ensure(70);y+=12;rect(ML,y,3,13,ACC);txt(title.toUpperCase(),ML+10,y+10.5,9.5,true,NAVY);y+=20;rule(y);y+=2}
 function kv(label,value){
  const LW=158;const L=wrap(label,LW-16,8.8,true);let V=wrap(value,CW-LW-16,10.5,false);let first=true;
  while(V.length){let n=Math.floor((room()-12)/14.5);if(n<Math.min(2,V.length)){newPage();continue}
   const take=V.splice(0,n);const labs=first?L:['(continued)'];const hh=Math.max(take.length*14.5,labs.length*11.5)+11;
   rect(ML,y,LW,hh,LIGHT);labs.forEach((s,i)=>txt(s,ML+8,y+15+i*11.5,8.8,true,SLATE));take.forEach((s,i)=>{if(s)txt(s,ML+LW+9,y+16+i*14.5,10.5,false,INK)});
   y+=hh;rule(y);first=false;if(V.length)newPage();}
 }
 function para(label,value){const L=wrap(value,CW,10.5,false);ensure(14+Math.min(L.length,2)*15+4);y+=6;txt(label,ML,y+10,9.2,true,SLATE);y+=15;
  for(const s of L){if(room()<15)newPage();if(s)txt(s,ML,y+11,10.5,false,INK);y+=15}y+=4}
 function seqItem(x){const L=wrap(x.description,CW,10.5,false);ensure(16+Math.min(L.length,2)*15+8);y+=6;const head=(x.when||'Time unknown');txt(head,ML,y+10,9.5,true,ACC);txt('  ·  '+x.basis,ML+tw(head,9.5,true),y+10,9,false,SLATE);y+=15;
  for(const s of L){if(room()<15)newPage();if(s)txt(s,ML,y+11,10.5,false,INK);y+=15}y+=4;rule(y)}
 function table(cols,rows){
  const ws=cols.map(c=>c.w*CW);
  const head=()=>{const HL=cols.map((c,i)=>wrap(c.h,ws[i]-12,8.8,true));const hh=Math.max(...HL.map(l=>l.length))*11+10;ensure(hh+30);rect(ML,y,CW,hh,NAVY);let x=ML;HL.forEach((ls,i)=>{ls.forEach((s,j)=>txt(s,x+6,y+13+j*11,8.8,true,'1 1 1'));x+=ws[i]});y+=hh};
  head();
  for(const r of rows){const CL=r.map((c,i)=>wrap(String(c??''),ws[i]-12,9.5,false));const hh=Math.max(...CL.map(l=>l.length))*13+10;if(hh>room()){newPage();head()}
   let x=ML;CL.forEach((ls,i)=>{ls.forEach((s,j)=>{if(s)txt(s,x+6,y+14+j*13,9.5,false,INK)});x+=ws[i]});y+=hh;rule(y)}
 }
 newPage();
 txt(m.heading,ML,y+10,10,true,ACC);y+=18;
 for(const s of wrap(m.title,CW,18,true)){ensure(24);txt(s,ML,y+17,18,true,NAVY);y+=23}
 txt(m.idLine,ML,y+11,10,false,SLATE);y+=20;
 for(const s of m.sections){
  if(s.kind==='kv'&&!s.rows.length)continue;
  sectionHead(s.title);
  if(s.kind==='kv')s.rows.forEach(([k,v])=>kv(k,v));
  if(s.kind==='paras')s.items.forEach(([k,v])=>para(k,v));
  if(s.kind==='seq')s.items.forEach(seqItem);
  if(s.kind==='table')table(s.cols,s.rows);
 }
 sectionHead('Notes');y+=4;
 for(const n of m.notes){for(const s of wrap(n,CW,8.6,false)){if(room()<12)newPage();txt(s,ML,y+9,8.6,false,SLATE);y+=12}y+=3}
 pages.push(ops);
 if(bad.size){const e=new Error('unsupported');e.unsupported=[...bad];throw e}
 // assemble
 const json=JSON.stringify(manifest(rec));const jb=new TextEncoder().encode(json);let jbin='';for(let i=0;i<jb.length;i+=8192)jbin+=String.fromCharCode.apply(null,jb.subarray(i,i+8192));
 const b64=btoa(jbin);const comment=['%DOCREC2-BEGIN'];for(let i=0;i<b64.length;i+=76)comment.push('%DR2:'+b64.slice(i,i+76));comment.push('%DOCREC2-END');
 const u16=s=>'<FEFF'+[...String(s)].map(ch=>{const c=ch.codePointAt(0);if(c>0xffff){const v=c-0x10000;return ((0xD800+(v>>10)).toString(16).padStart(4,'0')+(0xDC00+(v&1023)).toString(16).padStart(4,'0'))}return c.toString(16).padStart(4,'0')}).join('').toUpperCase()+'>';
 const dt=new Date(rec.generatedAt);const off=-dt.getTimezoneOffset();const p2=n=>String(Math.abs(n)).padStart(2,'0');
 const pdfDate=`D:${dt.getFullYear()}${p2(dt.getMonth()+1)}${p2(dt.getDate())}${p2(dt.getHours())}${p2(dt.getMinutes())}${p2(dt.getSeconds())}${off>=0?'+':'-'}${p2(Math.floor(Math.abs(off)/60))}'${p2(Math.abs(off)%60)}'`;
 const objs=[null,null,null];const add=s=>{objs.push(s);return objs.length-1};
 const F1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
 const F2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const kids=[];
 pages.forEach((pg,i)=>{const foot=[`BT /F1 7.8 Tf ${SLATE} rg ${ML} 30 Td (${lit(m.id+'  ·  Revision '+m.revision)}) Tj ET`,`BT /F1 7.8 Tf ${SLATE} rg ${(MR-tw(`Page ${i+1} of ${pages.length}`,7.8,false)).toFixed(2)} 30 Td (${lit(`Page ${i+1} of ${pages.length}`)}) Tj ET`];
  const stream=pg.concat(foot).join('\n');const sid=add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >> >> /Contents ${sid} 0 R >>`))});
 const fname=`${rec.id}-record.json`;
 const ef=add(`<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length ${jbin.length} /Params << /Size ${jb.length} /ModDate (${pdfDate}) >> >>\nstream\n${jbin}\nendstream`);
 const fs=add(`<< /Type /Filespec /F (${fname}) /UF ${u16(fname)} /Desc (Structured record data, schema documentation-record v2) /AFRelationship /Data /EF << /F ${ef} 0 R /UF ${ef} 0 R >> >>`);
 const info=add(`<< /Title ${u16(rec.id+' — '+rec.title)} /Subject ${u16(rec.heading)} /Keywords ${u16(`documentation-record; id=${rec.id}; prefix=${rec.prefix}; revision=${rec.revision}`)} /CreationDate (${pdfDate}) /ModDate (${pdfDate}) >>`);
 objs[1]=`<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(${fname}) ${fs} 0 R] >> >> /AF [${fs} 0 R] /PageMode /UseAttachments >>`;
 objs[2]=`<< /Type /Pages /Kids [${kids.map(k=>k+' 0 R').join(' ')}] /Count ${kids.length} >>`;
 let out='%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'+comment.join('\n')+'\n';const offs=[];
 for(let i=1;i<objs.length;i++){offs[i]=out.length;out+=`${i} 0 obj\n${objs[i]}\nendobj\n`}
 const xref=out.length;out+=`xref\n0 ${objs.length}\n0000000000 65535 f \n`+offs.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
 out+=`trailer\n<< /Size ${objs.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 const bytes=new Uint8Array(out.length);for(let i=0;i<out.length;i++)bytes[i]=out.charCodeAt(i)&255;
 return new Blob([bytes],{type:'application/pdf'});
}

/* ---------- validation ---------- */
function clearErr(k){const w=document.querySelector(`.field[data-k="${k}"]`);if(w){w.removeAttribute('aria-invalid');const e=w.querySelector('.err');if(e)e.textContent=''}}
function problems(){
 const t=T();const vis=visibleFields();const out=[];
 for(const k of t.req){const fd=vis.find(x=>x.k===k);if(fd&&!String(vals[k]||'').trim())out.push({k,msg:fd.t==='chips'?'Please choose one.':'Please fill this in.',label:fd.l})}
 if(t.check){const k=t.check(vals);if(k){const fd=vis.find(x=>x.k===k);out.push({k,msg:'Please fill this in.',label:fd?fd.l:k})}}
 if(vals.amount&&!/^\d{1,9}(\.\d{1,2})?$/.test(String(vals.amount).replace(/[$,\s]/g,'')))out.push({k:'amount',msg:'Use numbers only, like 125.50',label:'Amount'});
 if(typeKey==='CRT'&&String(vals.deadline||'').trim()&&!String(vals.deadlineSource||'').trim())out.push({k:'deadlineSource',msg:'Add where the deadline comes from (a verified deadline needs a source).',label:'Where the deadline comes from'});
 return out;
}
function validate(){
 if(vals.amount)vals.amount=String(vals.amount).replace(/[$,\s]/g,'');
 document.querySelectorAll('.field[aria-invalid]').forEach(w=>clearErr(w.dataset.k));
 if(files.some(x=>x.note==='Calculating fingerprint…')){toast('Still calculating file fingerprints — try again in a moment.');return false}
 const ps=problems();if(!ps.length)return true;
 for(const p of ps){const w=document.querySelector(`.field[data-k="${p.k}"]`);if(w){w.setAttribute('aria-invalid','true');w.querySelector('.err').textContent=p.msg}}
 const first=document.querySelector(`.field[data-k="${ps[0].k}"]`);
 if(first){if(first.closest('details'))first.closest('details').open=true;const focusEl=first.querySelector('input,textarea,.opt');first.scrollIntoView({behavior:reduced()?'auto':'smooth',block:'center'});setTimeout(()=>focusEl&&focusEl.focus({preventScroll:true}),250)}
 toast('Still needed: '+ps.map(p=>p.label.replace(/\?$/,'')).join(', '));
 return false;
}

/* ---------- actions ---------- */
const slug=s=>String(s).normalize('NFKD').replace(/[^\w]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
const inArtifact=()=>App.inArtifact();
const saveBlob=(b,n)=>App.saveBlob(b,n);
function tell(title,text){info(title,'<p>'+esc(text).replace(/\n/g,'<br>')+'</p>')}
function ask(title,text,okLabel='Continue'){return new Promise(res=>{const d=$('dlgInfo');let done=false;const f=$('infoFoot');f.innerHTML='';
 f.append(h('button',{class:'btn',type:'button',onclick:()=>d.close()},'Cancel'),h('button',{class:'btn primary',type:'button',onclick:()=>{done=true;d.close()}},okLabel));
 d.addEventListener('close',()=>res(done),{once:true});info(title,'<p>'+esc(text).replace(/\n/g,'<br>')+'</p>',true)})}
const pdfName=rec=>`${rec.id}${rec.revision>1?'_rev'+rec.revision:''}_${rec.eventDate}_${slug(rec.title)}.pdf`;
let saving=false;
async function saveRecord(mode){
 if(saving)return false; if(!validate())return false;
 if(files.some(it=>it.pending)){await Promise.all(files.map(it=>it.pending));if(saving)return false}
 const p=plan();const changed=!doc||p.fp!==doc.fp;const rec=collect(p,'direct-pdf');let blob=null,bad=null;
 try{blob=makePdf(buildModel(rec,'pdf'),rec)}catch(e){if(e.unsupported)bad=e.unsupported;else{console.error(e);tell('Not saved','The record could not be made: '+e.message+'\nNothing was numbered.');return false}}
 if(bad&&mode==='pdf'){$('ucChars').textContent=bad.join('  ');$('dlgUnicode').showModal();return false}
 saving=true;
 try{
  if(changed){
   const man=manifest(rec).record;
   const bytes=blob?new Uint8Array(await blob.arrayBuffer()):new TextEncoder().encode(JSON.stringify(manifest(rec),null,2));
   await App.saveCreated({bytes,name:blob?pdfName(rec):`${rec.id}${rec.revision>1?'_rev'+rec.revision:''}-record.json`,mime:blob?'application/pdf':'application/json',noPdf:!blob,manifest:man,
     files:files.map(it=>({file:it.file,name:it.name,size:it.size,type:it.type,lastModified:it.lastModified,hash:it.hash,ref:p.refs.get(it.uid)}))});
   commit(p,mode);
  }
  const savedLine=`<b>${rec.id}${rec.revision>1?` (revision ${rec.revision})`:''} is saved in your library.</b>`;
  if(mode==='pdf'){const ok=await saveBlob(blob,pdfName(rec));setStatus('ok',savedLine+(ok?' A PDF copy was offered for download — check your Downloads or Files app.':' The download was cancelled; the record is still saved.'))}
  else if(mode==='print'){if(inArtifact()){setStatus('warn',savedLine+' Printing is blocked inside this Claude view — use Download PDF, then print the PDF.')}else{$('printRoot').innerHTML=paperHtml(buildModel(rec,'print'));setStatus('ok',savedLine+' The print screen is open.');setTimeout(()=>window.print(),80)}}
  else setStatus('ok',savedLine+(bad?' (Saved as record data only — some characters can\'t go in a PDF. Use Print for a paper copy.)':'')+' Make a correction any time: change the form and save again — it keeps the same number as a new revision.');
  toast(changed?`${rec.id} saved to Ridion.`:`${rec.id} is already saved — no changes since.`);
  return true;
 }catch(e){console.error(e);tell('Not saved',(e&&e.message)||String(e));return false}
 finally{saving=false}
}
const download=()=>saveRecord('pdf');
const doPrint=()=>saveRecord('print');
function preview(){
 const p=plan();const rec=collect(p,'preview');const m=buildModel(rec,'preview');
 const ps=problems();
 m.banner=(ps.length?`<b>Still needed before you can create it:</b> ${esc(ps.map(x=>x.label.replace(/\?$/,'')).join(', '))}. `:'')+(p.isNew?`This is a preview. <b>${esc(rec.id)}</b> is the next available number — it's assigned when you save, download, or print.`:p.revision>doc.revision?`You changed the form after saving ${esc(rec.id)}. Saving again makes <b>revision ${p.revision}</b> with the same ID.`:`This matches ${esc(rec.id)} revision ${doc.revision}.`);
 $('pvPaper').innerHTML=paperHtml(m);$('rDlgPreview').showModal();$('pvEdit').focus();
}
function setStatus(kind,html){const s=$('status');s.className='status'+(kind?' '+kind:'');s.innerHTML=html}
function updateStatus(){
 if(!typeKey)return;const t=T();const p=plan();
 $('nextNo').innerHTML=doc?`Record <b>${doc.id}</b> · revision ${doc.revision}`:`Next number: <b>${code(t.prefix)}</b>`;
 if(!doc)setStatus('',`This will be <b>${code(t.prefix)}</b>. It's saved to your library when you tap Save, Download, or Print.${t.fin&&files.length?` Receipts will be ${[...p.refs.values()].join(', ')}.`:''}`);
}
function refreshSteps(){
 const s1=$('st1'),s2=$('st2'),s3=$('st3');[s1,s2,s3].forEach(s=>{s.removeAttribute('aria-current');s.classList.remove('done')});
 if(!typeKey||GROUP_OF(typeKey)!==activeGroup){s1.setAttribute('aria-current','step');return}
 s1.classList.add('done');
 if(doc){s2.classList.add('done');s3.setAttribute('aria-current','step')}else s2.setAttribute('aria-current','step');
}
function askClear(){
 if(!dirty()&&!doc){resetEntry(false);return}
 $('clWarn').textContent=doc?(doc.fp===fingerprint()?`${doc.id} is saved in your library.`:`You changed ${doc.id} after saving it. Those changes will be lost.`):'This entry hasn\'t been saved yet.';
 $('dlgClear').showModal();
}
function resetEntry(keep){
 const kept={};if(keep){if(vals.reporter)kept.reporter=vals.reporter;if(vals.children)kept.children=vals.children}
 vals={...kept,date:today()};files=[];moments=[];doc=null;touched=false;entryStarted=null;$('more').open=false;$('printRoot').innerHTML='';
 if(typeKey){renderForm();refreshSteps();$('describe').scrollIntoView({behavior:reduced()?'auto':'smooth'});toast(`Form cleared. The next record will be ${code(T().prefix)}.`)}
}

/* ---------- numbers, backups, checking PDFs ---------- */
function openNumbers(){const tb=$('numRows');tb.innerHTML='';for(const p of PREFIXES){tb.append(h('tr',{},h('td',{},h('label',{for:'n_'+p},`${PREFIX_NAMES[p]} `,h('span',{style:'color:var(--muted)'},`(${p})`))),h('td',{},h('input',{id:'n_'+p,type:'number',min:String(counters[p]),max:'999999',step:'1',value:String(counters[p]),inputmode:'numeric'}))))}$('dlgNumbers').showModal()}
async function saveNumbers(){const changes=[];for(const p of PREFIXES){const n=Number($('n_'+p).value);if(!Number.isSafeInteger(n)||n>999999){tell('Check the numbers',`${p}: enter a whole number.`);return}if(n<counters[p]){tell('Check the numbers',`${p} can't be lowered below ${counters[p]} — that could create duplicate IDs.`);return}if(n>counters[p])changes.push([p,n])}
 if(!changes.length){$('dlgNumbers').close();return}
 $('dlgNumbers').close();if(!(await ask('Raise these next numbers?',changes.map(([p,n])=>`${p}: ${pad(counters[p])} → ${pad(n)}`).join('\n'),'Raise numbers')))return;
 for(const[p,n] of changes)counters[p]=n;persist();$('dlgNumbers').close();updateStatus();renderFiles();toast('Next numbers updated.')}
async function exportBackup(){if(await saveBlob(new Blob([JSON.stringify({schema:'documentation-counters',schemaVersion:2,exportedAt:new Date().toISOString(),nextNumbers:counters},null,2)],{type:'application/json'}),`number-backup-${today()}.json`))toast('Number backup downloaded. Keep it somewhere safe.')}
async function importBackup(file){
 try{const o=JSON.parse(await file.text());const nn=o.nextNumbers;const okFmt=o.schema==='documentation-counters'||o.format==='lumidocket-counters';if(!okFmt||!nn||typeof nn!=='object')throw Error('This is not a number backup file.');
  const next={...counters};let raised=[];for(const p of PREFIXES){if(!(p in nn))continue;const n=Number(nn[p]);if(!Number.isSafeInteger(n)||n<1||n>999999)throw Error('Invalid number for '+p);if(n>next[p]){raised.push(`${p} → ${pad(n)}`);next[p]=n}}
  if(!raised.length){info('Backup checked','<p>Nothing to change — your current numbers are already the same or higher.</p>');return}
  if(!(await ask('Use the higher numbers?',raised.join('\n')+'\n\nNumbers are never lowered.','Use higher numbers')))return;counters=next;persist();updateStatus();renderFiles();toast('Numbers imported.')}
 catch(e){tell('Could not import',e.message)}
}
function b64utf8(b64){const bin=atob(b64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new TextDecoder().decode(u)}
function readManifest(text){
 let mm=text.match(/%DOCREC2-BEGIN\r?\n([\s\S]*?)%DOCREC2-END/);
 if(mm)return JSON.parse(b64utf8(mm[1].split(/\r?\n/).map(l=>l.replace(/^%DR2:/,'').trim()).join('')));
 mm=text.match(/%LUMIDOCKET_MANIFEST_V1_BEGIN\r?\n([\s\S]*?)%LUMIDOCKET_MANIFEST_V1_END/);
 if(mm)return adaptLegacy(JSON.parse(b64utf8(mm[1].split(/\r?\n/).map(l=>l.replace(/^%LD1:/,'').trim()).join(''))));
 return null;
}
function adaptLegacy(o){const r=o.record||{};const prefix=String(r.id||'').replace(/\d+$/,'');
 return {schema:'documentation-record',schemaVersion:2,adaptedFrom:'legacy-v1',record:{id:r.id,prefix,number:Number(String(r.id||'').replace(/^\D+/,''))||null,category:r.category||'',subcategory:r.finance?.type||r.category||'',heading:'',title:r.title||'',titleAutomatic:false,eventDate:r.eventDate||'',eventTime:r.eventTime||'',timeAccuracy:r.timeAccuracy||'',timeZone:r.timeZone||'',entryStarted:r.entryDate||'',generatedAt:r.generatedAt||'',revision:r.revision||1,output:'direct-pdf',preparedBy:r.reporter||'',basis:r.accountBasis||'',location:r.location||'',people:String(r.people||'').split(/\n+/).filter(Boolean),children:[],caseRefs:r.caseNumber?[{caseNumber:r.caseNumber,proceeding:r.caseType||''}]:[],relatedIds:r.relatedIds||[],fields:(r.extra||[]).map(x=>({key:'',label:x.label,value:x.value})),narrative:[['narrative','Account',r.narrative],['observed','Personally seen or heard',r.observed],['reported','Information reported by others',r.reported],['quotes','Exact statements',r.quotes],['outcome','Outcome',r.outcome],['followup','Follow-up',r.followup]].filter(x=>x[2]).map(([key,label,value])=>({key,label,value})),sequence:(r.moments||[]).map(x=>({when:x.time||'',description:x.detail||'',basis:x.basis||''})),files:(r.files||[]).map(x=>({ref:x.receiptId||null,role:x.receiptId?'receipt':'evidence',name:x.name,size:x.size,mime:x.mime,lastModified:x.lastModified||null,sha256:/^[0-9a-f]{64}$/.test(x.sha256||'')?x.sha256:null,originalIncluded:false})),receiptRefs:(r.files||[]).map(x=>x.receiptId).filter(Boolean),evidenceRefs:[],financial:r.finance||null}}}
async function checkPdf(file){
 try{const buf=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode.apply(null,buf.subarray(i,i+8192));
  const man=readManifest(s);
  if(!man){info('No record data found','<p>This PDF has no machine-readable record data. Printed or "Save as PDF" copies never contain it, and neither do PDFs made by other apps.</p>');return}
  const r=man.record;const prefix=r.prefix;const n=r.number;
  let body=`<p><b>${esc(r.id)}</b> — ${esc(r.title)}</p><ul><li>Type: ${esc(r.heading||r.subcategory||r.category)}</li><li>Event date: ${esc(fmtDate(r.eventDate))}</li><li>Revision: ${esc(r.revision)}</li><li>Created: ${r.generatedAt?esc(stamp(r.generatedAt)):'unknown'}</li>${r.receiptRefs?.length?`<li>Receipts: ${esc(r.receiptRefs.join(', '))}</li>`:''}${man.adaptedFrom?'<li>Made by an earlier version — read through the compatibility adapter.</li>':''}</ul>`;
  const foot=$('infoFoot');foot.innerHTML='';
  const raises=[];if(prefix in counters&&Number.isSafeInteger(n)&&n>=counters[prefix])raises.push([prefix,n+1]);
  const maxR=Math.max(0,...(r.receiptRefs||[]).map(x=>Number(String(x).replace(/^\D+/,''))||0));if(maxR>=counters.RCP)raises.push(['RCP',maxR+1]);
  if(raises.length){body+=`<p class="status warn">This browser's next number would repeat an ID already used in this PDF. Raise ${raises.map(([p,v])=>`${p} to ${pad(v)}`).join(' and ')} to prevent duplicates?</p>`;
   foot.append(h('button',{class:'btn primary',type:'button',onclick:()=>{for(const[p,v] of raises)counters[p]=Math.max(counters[p],v);persist();updateStatus();renderFiles();$('dlgInfo').close();toast('Numbers raised to avoid duplicates.')}},'Raise numbers'))}
  else body+='<p>Your next numbers are already past this document — no duplicate risk.</p>';
  info('PDF record data',body,true);
 }catch(e){info('Could not read this PDF','<p>'+esc(e.message)+'</p>')}
}
function info(title,html,keepFoot){$('infoTitle').textContent=title;$('infoBody').innerHTML=html;if(!keepFoot)$('infoFoot').innerHTML='';$('dlgInfo').showModal()}
const GUIDE=`<div class="rpaper" style="--pa:#1f2d4d"><div class="hd">QUICK-START GUIDE</div><h1>Making a record</h1>
<h2>1. Choose</h2><p>Tap what you're documenting. Communications, Financial, and Child &amp; Care ask one more question so you get the right form.</p>
<h2>2. Describe</h2><p>Fill in the starred items — usually just the date and a few taps. Tap a choice again to unselect it. Use <b>Now</b> for the current time, or mark a time Approximate. Anything else goes under <b>More details (optional)</b>. Leave the title blank on most types and one is made from your choices.</p><p>Write only what you saw, heard, or were told — and say which. Put exact words in quotation marks only when you're sure of them.</p>
<h2>3. Add files</h2><p>Tap <b>Add files</b> for photos, screenshots, receipts, audio, video, or PDFs. Files are never changed or uploaded. The PDF lists each file's name, size, and SHA-256 fingerprint, but the file itself is <b>not</b> inside the PDF — keep the originals.</p>
<h2>4. Document numbers</h2><p>Each type counts on its own: INCD001, POLI374, COMM019 and MED003 can all exist together. Receipts get their own RCP numbers, separate from the number printed on the receipt. Previewing never uses a number. Downloading or printing does. Correcting and downloading again keeps the same ID and adds a revision number.</p>
<h2>5. Preview and download</h2><p><b>Download PDF</b> makes a PDF that also carries machine-readable data for a future records app. <b>Print / Save PDF</b> uses your browser's print screen — it handles any language or emoji but has no machine-readable data. The app can't confirm a download finished, so check your Downloads or Files app.</p>
<h2>6. Clear the form</h2><p>After you've checked the PDF, tap <b>Clear Form &amp; Start Over</b>. You can keep your name and the children's names for the next record during this visit. Numbers are kept.</p>
<h2>7. Back up numbers</h2><p>Numbers live in this browser only. Use <b>Numbers &amp; help → Export number backup</b> now and then, and <b>Import</b> it on a new phone or browser. <b>Check an existing PDF</b> reads a PDF you made and can raise the numbers so IDs are never repeated.</p>
<h2>Privacy</h2><p>Nothing you type and no file you add is saved by this app or sent anywhere. Only the next-number counters are stored in this browser. Your entry disappears when you clear it or close the page. Downloaded PDFs, browser history, print history, and device backups are outside the app's control and are not erased by clearing.</p>
<h2>Technical notes</h2><p>Works in current Safari (iPhone), Chrome (Android and desktop), Edge, and Firefox. File fingerprints need a secure page (https, or opening the file directly in most browsers). Fingerprints are skipped for files over 150 MB. Direct PDFs use built-in Helvetica (Western European characters); other scripts and emoji need Print / Save PDF. Record data is attached inside each direct PDF as <i>ID-record.json</i> (schema "documentation-record", version 2) and also as a text block (<i>%DOCREC2-BEGIN</i> … <i>%DR2:</i> base64 … <i>%DOCREC2-END</i>). PDFs made by the earlier version are read through a compatibility adapter, and older COM and CHD counters are kept.</p></div>`;

/* ---------- wiring ---------- */
function bind(){
 renderCards();
 $('fileInput').addEventListener('change',e=>{addFiles([...e.target.files]);e.target.value=''});
 $('addMoment').addEventListener('click',()=>{moments.push({when:'',detail:'',basis:BASIS[0]});renderMoments();const ins=$('seqList').querySelectorAll('input');ins[ins.length-1]?.focus()});
 $('btnDownload').addEventListener('click',download);$('btnPreview').addEventListener('click',preview);$('btnPrint').addEventListener('click',doPrint);
 $('pvEdit').addEventListener('click',()=>$('rDlgPreview').close());$('pvDownload').addEventListener('click',()=>{$('rDlgPreview').close();saveRecord('save')});
 $('btnClear').addEventListener('click',askClear);$('clCancel').addEventListener('click',()=>$('dlgClear').close());$('clOk').addEventListener('click',()=>{$('dlgClear').close();resetEntry($('keepNames').checked)});
 $('ucBack').addEventListener('click',()=>$('dlgUnicode').close());$('ucPrint').addEventListener('click',()=>{$('dlgUnicode').close();doPrint()});
 document.querySelectorAll('dialog.rx [data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
 $('btnSave').addEventListener('click',()=>saveRecord('save'));
 $('btnRun').addEventListener('click',()=>App.runReport());
 $('nmSave').addEventListener('click',saveNumbers);
 window.addEventListener('beforeunload',e=>{if(typeKey&&dirty()&&(!doc||doc.fp!==fingerprint())){e.preventDefault();e.returnValue=''}});
}
bind();
window.Record={
 onUnlock(){syncCounters();if(!typeKey){typeKey='INC';activeGroup='INC';vals.date=today();renderForm()}renderCards();updateStatus()},
 render(){syncCounters();if(typeKey){updateStatus();renderFiles()}},
 hasUnsaved(){return !!typeKey&&dirty()&&(!doc||doc.fp!==fingerprint())},
 save(){return saveRecord('save')},
 openNumbers(){syncCounters();openNumbers()},exportBackup,importBackup,
 guide:()=>GUIDE
};
})();
