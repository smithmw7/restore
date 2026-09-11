import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url=process.env.RESTORE_REVIEW_URL||'http://127.0.0.1:5211/briefcase-review.html';
const out='output/briefcase/review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--mute-audio']});
const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__briefcaseReview?.ready,null,{timeout:90000});
 for(const name of ['front','rear','top','under','detail']){
  await page.click(`[data-angle="${name}"]`);await page.waitForTimeout(450);await page.screenshot({path:`${out}/${name}.png`});
 }
 const detents=[];
 for(const digit of [...Array(10).keys(),0]){
  await page.locator('#dial').fill(String(digit));
  await page.waitForFunction(digit=>[0,1,2,3].every(index=>{
   const angle=window.__briefcaseReview.asset.getObjectByName(`Wheel_${index}`).rotation.x;
   return Math.abs(Math.atan2(Math.sin(angle+digit*Math.PI/5),Math.cos(angle+digit*Math.PI/5)))<.002;
  }),digit);
  assert.deepEqual((await page.evaluate(()=>window.__briefcaseReview.getState())).digits,[digit,digit,digit,digit]);
  detents.push({digit,angles:await page.evaluate(()=>[0,1,2,3].map(i=>window.__briefcaseReview.asset.getObjectByName(`Wheel_${i}`).rotation.x))});
  if([4,9].includes(digit))await page.screenshot({path:`${out}/numeral-${digit}.png`});
 }
 // The last 9-to-0 move continues to -2pi instead of reversing across nine digits.
 assert.ok(detents.at(-1).angles.every(angle=>Math.abs(angle+Math.PI*2)<.002));
 await page.click('[data-angle="front"]');await page.click('[data-lid="1"]');await page.waitForTimeout(1200);await page.screenshot({path:`${out}/open.png`});
 assert.ok((await page.evaluate(()=>window.__briefcaseReview.getState())).open>.99);
 await page.locator('#explode').fill('1');await page.waitForTimeout(1200);await page.screenshot({path:`${out}/exploded.png`});
 assert.ok((await page.evaluate(()=>window.__briefcaseReview.getState())).explode>.99);
 await page.locator('#explode').fill('0');await page.click('[data-lid="0"]');await page.waitForTimeout(1000);
 assert.deepEqual(errors,[]);
 const report={url,angles:5,open:true,exploded:true,detents,errors,stats:await page.evaluate(()=>window.__briefcaseReview.stats)};
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
