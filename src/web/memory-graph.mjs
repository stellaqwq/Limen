// A visual tree, not a biological simulation or an inferred semantic relation.
// Every stored memory owns one node and exactly one incoming connection.
export function buildMemoryGraph(memories) {
  const kinds=['fact','preference','relationship','plan','event'];
  const hash=text=>{let h=2166136261;for(const c of String(text)){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;};
  const random=(id,salt)=>hash(id+':'+salt)/4294967295;
  const root={id:'__root__',position:[0,0,0],type:'root',status:'active'};
  const nodes=[root],edges=[],groups=new Map();
  const sorted=[...memories].sort((a,b)=>(a.created_at||0)-(b.created_at||0)||a.id.localeCompare(b.id));
  for(const memory of sorted){
    const kind=Math.max(0,kinds.indexOf(memory.type)),angle=kind*Math.PI*2/5+(random(memory.id,1)-0.5)*0.9;
    const radius=2.1+random(memory.id,2)*2.5;
    const position=[Math.cos(angle)*radius,(random(memory.id,3)-0.5)*5.8,Math.sin(angle)*radius*0.82];
    const node={id:memory.id,position,type:memory.type,status:memory.status,key:memory.key,pinned:memory.pinned};
    const siblings=groups.get(memory.type)||[];
    let parent=root,best=Infinity;
    // Earlier memories are stable parents; appending a memory keeps old edges.
    for(const candidate of siblings.slice(-80)){
      const distance=position.reduce((n,v,i)=>n+(v-candidate.position[i])**2,0);
      if(distance<best){best=distance;parent=candidate;}
    }
    const a=parent.position,b=position,seed=random(memory.id,4),bend=(seed-0.5)*0.9,points=[];
    const c1=a.map((v,i)=>v+(b[i]-v)*0.34+(i===1?0.55:bend));
    const c2=a.map((v,i)=>v+(b[i]-v)*0.74+(i===2?bend:-bend*0.45));
    for(let j=0;j<=36;j++){const t=j/36,u=1-t;points.push(a.map((v,i)=>u*u*u*v+3*u*u*t*c1[i]+3*u*t*t*c2[i]+t*t*t*b[i]));}
    edges.push({id:memory.id,from:parent.id,to:node.id,type:memory.type,status:memory.status,seed,points});
    nodes.push(node);siblings.push(node);groups.set(memory.type,siblings);
  }
  return {nodes,edges};
}
