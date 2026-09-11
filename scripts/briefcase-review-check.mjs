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
 await page.click('[data-angle="front"]');await page.click('[data-lid="1"]');await page.waitForTimeout(1200);await page.screenshot({path:`${out}/open.png`});
 assert.ok((await page.evaluate(()=>window.__briefcaseReview.getState())).open>.99);
 await page.locator('#explode').fill('1');await page.waitForTimeout(1200);await page.screenshot({path:`${out}/exploded.png`});
 assert.ok((await page.evaluate(()=>window.__briefcaseReview.getState())).explode>.99);
 await page.locator('#explode').fill('0');await page.click('[data-lid="0"]');await page.waitForTimeout(1000);
 assert.deepEqual(errors,[]);
 const report={url,angles:5,open:true,exploded:true,errors,stats:await page.evaluate(()=>window.__briefcaseReview.stats)};
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
