import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { readEnv, root } from './db-utils.mjs'

if (process.env.RUN_LIVE_LOOTBOX_BROWSER_TEST !== 'true') throw new Error('Set RUN_LIVE_LOOTBOX_BROWSER_TEST=true to run the disposable Lootbox browser test.')

const env = readEnv()
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5174'
const outputDir = path.join(root,'output','lootbox-browser')
const email = `lootbox-ui-${Date.now()}@example.com`
const password = `Lootbox-UI-${Date.now()}!`
const admin = createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const player = createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
let userId
let browser
const errors = []
const check = (condition,message) => { if (!condition) throw new Error(message) }

try {
  fs.mkdirSync(outputDir,{recursive:true})
  const created = await admin.auth.admin.createUser({email,password,email_confirm:true})
  if (created.error) throw created.error
  userId = created.data.user.id
  const signedIn = await player.auth.signInWithPassword({email,password})
  if (signedIn.error) throw signedIn.error
  const rollcaster = (await player.from('starter_rollcaster_options').select('rollcaster_id').eq('is_active',true).order('sort_order').limit(1).single()).data
  const critter = (await player.from('starter_options').select('critter_id').eq('is_active',true).order('sort_order').limit(1).single()).data
  check(rollcaster && critter,'Starter fixtures are required for the disposable user.')
  const starterRollcaster = await player.rpc('select_starter_rollcaster',{p_rollcaster_id:rollcaster.rollcaster_id})
  if (starterRollcaster.error) throw starterRollcaster.error
  const starterCritter = await player.rpc('select_starter_critter',{p_critter_id:critter.critter_id})
  if (starterCritter.error) throw starterCritter.error
  const coins = await admin.from('user_currencies').upsert({user_id:userId,currency_id:'coins',balance:500},{onConflict:'user_id,currency_id'})
  if (coins.error) throw coins.error

  browser = await chromium.launch({headless:process.env.HEADED!=='1'})
  const page = await browser.newPage({viewport:{width:1440,height:900}})
  page.on('pageerror',(error)=>errors.push(String(error)))
  page.on('console',(message)=>{ if(message.type()==='error') errors.push(message.text()) })
  await page.goto(baseUrl,{waitUntil:'networkidle'})
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button',{name:'Log in'}).click()
  try {
    await page.getByRole('button',{name:'Shop',exact:true}).waitFor({timeout:15000})
  } catch (error) {
    await page.screenshot({path:path.join(outputDir,'00-login-failure.png'),fullPage:true})
    const state = await page.evaluate(()=>typeof window.render_game_to_text==='function'?window.render_game_to_text():document.body.innerText)
    throw new Error(`Disposable player did not reach Home. State: ${state}. Browser errors: ${errors.join(' | ')}`,{cause:error})
  }
  await page.getByRole('button',{name:'Shop',exact:true}).click()
  await page.getByRole('tab',{name:'Lootbox Shop'}).click()
  await page.getByRole('button',{name:/Common Lootbox/}).waitFor()
  await page.screenshot({path:path.join(outputDir,'01-shop-grid.png'),fullPage:true})
  await page.getByRole('button',{name:/Common Lootbox/}).click({force:true})
  const modal = page.getByRole('dialog',{name:'Common Lootbox'})
  await modal.getByText('Possible rewards').waitFor()
  check(await modal.locator('.lootbox-pool-preview article').count()===5,'Lootbox detail must show all five possible rewards.')
  await page.screenshot({path:path.join(outputDir,'02-shop-detail.png'),fullPage:true})
  await modal.getByRole('button',{name:/Purchase/}).click()
  await modal.getByRole('button',{name:/Open Now/}).waitFor()
  check(await page.evaluate(() => document.activeElement?.textContent?.includes('Open Now') ?? false),'Purchased Lootbox popup should focus Open Now for keyboard controls.')
  await page.screenshot({path:path.join(outputDir,'03-purchased.png'),fullPage:true})
  await modal.getByRole('button',{name:'Send to Bag'}).click()
  await page.getByRole('button',{name:'Back'}).click()
  await page.getByRole('button',{name:'Bag',exact:true}).click()
  await page.getByRole('tab',{name:'Lootboxes'}).click()
  await page.getByRole('button',{name:/Common Lootbox/}).waitFor()
  await page.screenshot({path:path.join(outputDir,'04-bag.png'),fullPage:true})
  await page.getByRole('button',{name:/Common Lootbox/}).click()
  await page.getByRole('dialog',{name:'Common Lootbox'}).getByRole('button',{name:/Open Now/}).click()
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='reel',{timeout:5000})
  await page.screenshot({path:path.join(outputDir,'05-reel.png'),fullPage:true})
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='result',{timeout:9000})
  await page.waitForTimeout(500)
  const winningAmount = await page.locator('.lootbox-reel-cell.winner strong').textContent()
  const resultAmount = await page.locator('.lootbox-result > strong').textContent()
  check(winningAmount===resultAmount,`Reel winner ${winningAmount} did not match the predetermined reward ${resultAmount}.`)
  const alignment = await page.evaluate(() => {
    const winnerNode = document.querySelector('.lootbox-reel-cell.winner')
    const markerNode = document.querySelector('.lootbox-reel-center')
    const trackNode = document.querySelector('.lootbox-reel-track')
    const winner = winnerNode?.getBoundingClientRect()
    const marker = markerNode?.getBoundingClientRect()
    const track = trackNode?.getBoundingClientRect()
    const cells = [...document.querySelectorAll('.lootbox-reel-cell')]
    return winner&&marker&&track ? {winnerCenter:winner.left+winner.width/2,winnerLeft:winner.left,winnerWidth:winner.width,winnerIndex:cells.indexOf(winnerNode),markerCenter:marker.left+marker.width/2,trackLeft:track.left,trackWidth:track.width,cellCount:cells.length,transform:getComputedStyle(trackNode).transform} : null
  })
  check(alignment&&Math.abs(alignment.winnerCenter-alignment.markerCenter)<2,`Predetermined winner missed the center marker: ${JSON.stringify(alignment)}.`)
  await page.screenshot({path:path.join(outputDir,'06-result.png'),fullPage:true})
  const openingCount = await admin.from('lootbox_openings').select('id',{count:'exact',head:true}).eq('user_id',userId)
  check(openingCount.count===1,'Opening animation must correspond to exactly one persisted backend opening.')
  check(!errors.length,`Browser errors: ${errors.join(' | ')}`)
  console.log(`Lootbox browser flow passed. Screenshots: ${outputDir}`)
} finally {
  await browser?.close().catch(()=>undefined)
  await player.auth.signOut().catch(()=>undefined)
  if(userId) await admin.auth.admin.deleteUser(userId).catch(()=>undefined)
}
