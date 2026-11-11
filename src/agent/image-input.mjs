// Present every sampled frame in one numbered image to bound vision input cost.
// Original captures remain the evidence; only the transient model input changes.
export async function observationContactSheet(images){
  if(images.length<2)return images;
  const {createCanvas,loadImage}=await import('@napi-rs/canvas');
  const decoded=[];for(const image of images){
    const bytes=Buffer.from(image.split(',')[1],'base64');
    if(bytes.length<64||bytes[0]!==0xff||bytes[1]!==0xd8||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)throw Error('Invalid observation JPEG');
    decoded.push(await loadImage(bytes));
  }
  const columns=2,rows=Math.ceil(decoded.length/columns),labelHeight=24;
  const tileWidth=480,tileHeight=Math.min(360,Math.floor(1280/rows)-labelHeight);
  const canvas=createCanvas(columns*tileWidth,rows*(tileHeight+labelHeight)),context=canvas.getContext('2d');
  context.fillStyle='#151515';context.fillRect(0,0,canvas.width,canvas.height);
  for(const [index,frame] of decoded.entries()){
    const x=index%columns*tileWidth,y=Math.floor(index/columns)*(tileHeight+labelHeight),scale=Math.min(tileWidth/frame.width,tileHeight/frame.height),width=frame.width*scale,height=frame.height*scale;
    context.fillStyle='#ffffff';context.font='16px sans-serif';context.fillText('Frame '+(index+1),x+10,y+18);
    context.drawImage(frame,x+(tileWidth-width)/2,y+labelHeight+(tileHeight-height)/2,width,height);
  }
  return [canvas.toDataURL('image/jpeg',0.72)];
}
