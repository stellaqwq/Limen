import {buildMemoryGraph} from './memory-graph.mjs';

export const memoryPalette={root:[0.69,0.76,1],fact:[0.62,0.57,1],preference:[0.24,0.84,0.75],relationship:[0.94,0.48,0.69],plan:[1,0.72,0.35],event:[0.34,0.68,1]};
export class NeuralMemoryScene {
  constructor(canvas,onSelect,onFailure){
    this.canvas=canvas;this.onSelect=onSelect;this.onFailure=onFailure;this.graph={nodes:[],edges:[]};this.selected=null;this.births=new Map();
    this.yaw=0.38;this.pitch=-0.1;this.distance=13.8;this.active=false;this.paused=matchMedia('(prefers-reduced-motion: reduce)').matches;this.pointers=new Map();this.frame=0;this.initial=true;
    try{this.init();}catch(error){this.error=error.message;this.failed=true;onFailure(true);}
    this.resizeObserver=new ResizeObserver(()=>this.render());this.resizeObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.failed=true;this.stop();onFailure(true);});
    canvas.addEventListener('webglcontextrestored',()=>{try{this.init();this.failed=false;this.buffers();onFailure(false);this.render();}catch{onFailure(true);}});
    canvas.addEventListener('pointerdown',event=>{if(event.button>0)return;canvas.setPointerCapture(event.pointerId);this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});this.gesture={x:event.clientX,y:event.clientY,moved:false};});
    canvas.addEventListener('pointermove',event=>{
      const previous=this.pointers.get(event.pointerId);if(!previous)return;
      const dx=event.clientX-previous.x,dy=event.clientY-previous.y;
      if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==event.pointerId)?.[1];if(other){const before=Math.hypot(previous.x-other.x,previous.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y);this.distance=Math.max(7,Math.min(26,this.distance+(before-after)*0.035));}}
      else{this.yaw+=dx*0.006;this.pitch=Math.max(-1.2,Math.min(1.2,this.pitch+dy*0.006));}
      if(Math.hypot(event.clientX-this.gesture.x,event.clientY-this.gesture.y)>4)this.gesture.moved=true;
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});this.render();
    });
    canvas.addEventListener('pointerup',event=>{const click=this.pointers.size===1&&!this.gesture?.moved;this.pointers.delete(event.pointerId);if(click){const id=this.pick(event.clientX,event.clientY);if(id)this.onSelect(id);}});
    canvas.addEventListener('pointercancel',event=>this.pointers.delete(event.pointerId));
    canvas.addEventListener('wheel',event=>{event.preventDefault();this.zoom(event.deltaY>0?1.08:0.92);},{passive:false});
    canvas.addEventListener('keydown',event=>{
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();this.yaw+=(event.key==='ArrowLeft'?-0.1:event.key==='ArrowRight'?0.1:0);this.pitch=Math.max(-1.2,Math.min(1.2,this.pitch+(event.key==='ArrowUp'?-0.08:event.key==='ArrowDown'?0.08:0)));this.render();}
      else if(['+','=','-'].includes(event.key)){event.preventDefault();this.zoom(event.key==='-'?1.1:0.9);}
      else if(event.key==='Home'){event.preventDefault();this.reset();}
    });
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();else this.render();});
  }
  init(){
    const gl=this.canvas.getContext('webgl',{alpha:false,antialias:true,powerPreference:'low-power'});if(!gl)throw Error('WebGL unavailable');this.gl=gl;
    const vertex=`precision mediump float;attribute vec3 aPosition;attribute vec3 aColor;attribute float aT;attribute float aSeed;attribute float aBirth;attribute float aSelected;
      uniform float uYaw,uPitch,uDistance,uAspect,uTime,uPoints,uMotion;varying vec3 vColor;varying float vAlpha;
      void main(){float cy=cos(uYaw),sy=sin(uYaw),cx=cos(uPitch),sx=sin(uPitch);vec3 y=vec3(cy*aPosition.x+sy*aPosition.z,aPosition.y,-sy*aPosition.x+cy*aPosition.z);vec3 p=vec3(y.x,cx*y.y-sx*y.z,sx*y.y+cx*y.z);p.z-=uDistance;
      float f=2.605;gl_Position=vec4(p.x*f/uAspect,p.y*f,-1.002002*p.z-0.2002002,-p.z);gl_PointSize=clamp(aT*300.0/(-p.z),3.0,84.0);
      float depth=clamp(1.25+p.z*0.038,0.22,0.94);float pulse=exp(-pow((fract(aT-uTime*0.16+aSeed)-0.5)*8.0,2.0))*uMotion;
      float grown=uPoints>0.5?step(0.75,uTime-aBirth):step(aT,clamp((uTime-aBirth)/0.75,0.0,1.0));
      vColor=mix(aColor,vec3(0.94,0.97,1.0),aSelected*0.8);vAlpha=grown*depth*(uPoints>0.5?0.78:0.32+pulse*0.4+aSelected*0.4);}`;
    const fragment=`precision mediump float;uniform float uPoints;varying vec3 vColor;varying float vAlpha;void main(){float alpha=vAlpha;vec3 color=vColor;
      if(uPoints>0.5){float r=length(gl_PointCoord-vec2(0.5))*2.0;if(r>1.0)discard;alpha*=exp(-r*r*4.2);color+=vec3(exp(-r*r*55.0)*0.75);}gl_FragColor=vec4(color,alpha);}`;
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('Shader compilation failed: '+gl.getShaderInfoLog(shader));return shader;};
    this.program=gl.createProgram();const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error('Shader linking failed: '+gl.getProgramInfoLog(this.program));
    this.attributes=['aPosition','aColor','aT','aSeed','aBirth','aSelected'].map(name=>gl.getAttribLocation(this.program,name));
    this.uniforms=Object.fromEntries(['uYaw','uPitch','uDistance','uAspect','uTime','uPoints','uMotion'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
    this.lineBuffer=gl.createBuffer();this.pointBuffer=gl.createBuffer();gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
  }
  setData(memories){
    const now=performance.now()/1000,ids=new Set(memories.map(m=>m.id));
    for(const id of this.births.keys())if(!ids.has(id))this.births.delete(id);
    for(const id of ids)if(!this.births.has(id))this.births.set(id,this.initial||this.paused?now-2:now);
    this.initial=false;this.graph=buildMemoryGraph(memories);this.buffers();
    this.canvas.dataset.edges=String(this.graph.edges.length);this.canvas.dataset.nodes=String(this.graph.nodes.length);this.render();
  }
  buffers(){
    if(this.failed||!this.gl)return;const gl=this.gl,lines=[],points=[];
    const color=node=>{const c=memoryPalette[node.type]||memoryPalette.fact;return node.status==='archived'?c.map(v=>v*0.37):c;};
    for(const edge of this.graph.edges){const c=color(edge),birth=this.births.get(edge.id)||0;
      for(let j=1;j<edge.points.length;j++)for(const k of [j-1,j])lines.push(...edge.points[k],...c,k/(edge.points.length-1),edge.seed,birth,Number(edge.id===this.selected));
    }
    for(const node of this.graph.nodes)points.push(...node.position,...color(node),node.id==='__root__'?2.7:node.id===this.selected?1.35:0.8,0,node.id==='__root__'?-10:this.births.get(node.id)||0,Number(node.id===this.selected));
    this.lineCount=lines.length/10;this.pointCount=points.length/10;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.lineBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(lines),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.pointBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.STATIC_DRAW);
  }
  render(){
    if(this.failed||!this.gl||!this.active||document.hidden)return;
    const gl=this.gl,rect=this.canvas.getBoundingClientRect();if(rect.width<1||rect.height<1)return;
    const dpr=Math.min(devicePixelRatio||1,1.75),w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    gl.viewport(0,0,w,h);gl.clearColor(0.043,0.055,0.105,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);
    for(const [key,v] of Object.entries({uYaw:this.yaw,uPitch:this.pitch,uDistance:this.distance/Math.min(1,w/h),uAspect:w/h,uTime:performance.now()/1000,uPoints:0,uMotion:this.paused?0:1}))gl.uniform1f(this.uniforms[key],v);
    const draw=(buffer,count,mode)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buffer);let offset=0;for(let i=0;i<this.attributes.length;i++){const size=i<2?3:1;gl.enableVertexAttribArray(this.attributes[i]);gl.vertexAttribPointer(this.attributes[i],size,gl.FLOAT,false,40,offset*4);offset+=size;}gl.drawArrays(mode,0,count);};
    draw(this.lineBuffer,this.lineCount||0,gl.LINES);gl.uniform1f(this.uniforms.uPoints,1);draw(this.pointBuffer,this.pointCount||0,gl.POINTS);
    this.canvas.dataset.renderer='webgl';
    if(!this.paused&&this.graph.edges.length&&!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();});
  }
  setActive(active){this.active=active;if(!active)this.stop();else this.render();}
  stop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;}
  toggleMotion(){this.paused=!this.paused;if(this.paused){this.stop();for(const id of this.births.keys())this.births.set(id,performance.now()/1000-2);this.buffers();}this.render();return !this.paused;}
  select(id){this.selected=id;this.buffers();this.render();}
  zoom(factor){this.distance=Math.max(7,Math.min(26,this.distance*factor));this.render();}
  reset(){this.yaw=0.38;this.pitch=-0.1;this.distance=13.8;this.render();}
  project(position){
    const r=this.canvas.getBoundingClientRect(),cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cx=Math.cos(this.pitch),sx=Math.sin(this.pitch);
    const [x,y,z]=position,xx=cy*x+sy*z,zz=-sy*x+cy*z,yy=cx*y-sx*zz,depth=this.distance/Math.min(1,r.width/r.height)-(sx*y+cx*zz),f=2.605;
    return {x:r.left+(xx*f/depth/(r.width/r.height)+1)*r.width/2,y:r.top+(1-yy*f/depth)*r.height/2,depth};
  }
  screenPoint(id){const node=this.graph.nodes.find(n=>n.id===id);return node?this.project(node.position):null;}
  pick(x,y){
    let result=null,best=14;
    for(const node of this.graph.nodes){if(node.id==='__root__')continue;const p=this.project(node.position),d=Math.hypot(p.x-x,p.y-y);if(d<best){best=d;result=node.id;}}
    if(result)return result;
    best=7;for(const edge of this.graph.edges)for(let i=1;i<edge.points.length;i++){
      const a=this.project(edge.points[i-1]),b=this.project(edge.points[i]),dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
      const d=Math.hypot(x-a.x-t*dx,y-a.y-t*dy);if(d<best){best=d;result=edge.id;}
    }return result;
  }
}
export const memorySceneClient='const memoryPalette='+JSON.stringify(memoryPalette)+';\n'+buildMemoryGraph.toString()+'\n'+NeuralMemoryScene.toString();
