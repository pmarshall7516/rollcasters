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
// The browser flow only uses Supabase Auth, PostgREST, and RPC calls. Keep the
// Node 20 disposable test independent of Realtime's browser WebSocket global.
if (!globalThis.WebSocket) globalThis.WebSocket = class WebSocket {}
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
  const shopCard = page.locator('.lootbox-shop-card')
  await page.screenshot({path:path.join(outputDir,'01-shop-grid.png'),fullPage:true})
  const cardHeight = await shopCard.evaluate((node)=>node.getBoundingClientRect().height)
  const shopCardWidth = await shopCard.evaluate((node)=>node.getBoundingClientRect().width)
  const shopPurchaseWidth = await shopCard.getByRole('button',{name:'Purchase'}).evaluate((node)=>node.getBoundingClientRect().width)
  check(cardHeight < 240,`Lootbox shop cards should stay compact; height was ${cardHeight}px.`)
  check(shopCardWidth < 240 && shopPurchaseWidth < 200,`Lootbox shop cards and Purchase buttons should stay narrow; widths were ${shopCardWidth}px / ${shopPurchaseWidth}px.`)
  const spriteControls = await shopCard.locator('.lootbox-card-sprite').evaluate((node)=>node.querySelectorAll('button,input,select,textarea,[tabindex]').length)
  check(spriteControls===0,'Shop card sprites must not contain keyboard-focusable controls.')
  await shopCard.getByRole('button',{name:'Purchase'}).click()
  const purchaseModal = page.getByRole('dialog',{name:'Common Lootbox'})
  await purchaseModal.getByText('Possible rewards').waitFor()
  const purchaseModalWidth = await purchaseModal.evaluate((node)=>node.getBoundingClientRect().width)
  check(purchaseModalWidth <= 820,`Lootbox shop popup should fit the fixed opening footprint; width was ${purchaseModalWidth}px.`)
  check(await page.evaluate(() => JSON.parse(window.render_game_to_text()).lootboxOpeningPhase === 'idle'),'The shop-grid Purchase button should open an idle popup.')
  check(await purchaseModal.getByRole('button',{name:/Purchase/}).count()===1,'An unowned Lootbox popup must show its Purchase action.')
  const shardShape = await purchaseModal.locator('.lootbox-pool-shard-art .shard-sprite-frame').first().evaluate((node) => ({
    clipPath: getComputedStyle(node).clipPath,
    aspectRatio: getComputedStyle(node).aspectRatio,
  }))
  check(shardShape.clipPath.includes('polygon') && shardShape.aspectRatio.includes('1.7'),`Lootbox shard art must use the shared diamond sprite frame: ${JSON.stringify(shardShape)}`)
  await page.screenshot({path:path.join(outputDir,'01-purchase-popup.png'),fullPage:true})
  await purchaseModal.getByRole('button',{name:/Purchase/}).click()
  await purchaseModal.getByRole('button',{name:'Open Now'}).waitFor()
  await purchaseModal.getByRole('button',{name:'Send to Bag'}).waitFor()
  await shopCard.getByRole('button',{name:'Open Now'}).waitFor()
  await shopCard.getByRole('button',{name:'Send to Bag'}).waitFor()
  const purchasedInventory = await player.from('user_lootboxes').select('lootbox_id,quantity').eq('lootbox_id','001').gt('quantity',0).maybeSingle()
  if (purchasedInventory.error) throw purchasedInventory.error
  check(Boolean(purchasedInventory.data),'Popup Purchase must be present in the server Bag inventory before a refresh.')

  await purchaseModal.getByRole('button',{name:'Send to Bag'}).click()
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === 'bag', { timeout: 10000 })
  await page.getByRole('heading',{name:'Bag',exact:true}).waitFor()
  await page.getByRole('tab',{name:'Lootboxes'}).click()
  const bagCard = page.locator('.lootbox-bag-card')
  await bagCard.getByRole('button',{name:'Open'}).waitFor()
  const bagCardHeight = await bagCard.evaluate((node)=>node.getBoundingClientRect().height)
  const bagCardWidth = await bagCard.evaluate((node)=>node.getBoundingClientRect().width)
  const bagOpenWidth = await bagCard.getByRole('button',{name:'Open'}).evaluate((node)=>node.getBoundingClientRect().width)
  check(bagCardHeight < 260,`Bag Lootbox cards should stay compact; height was ${bagCardHeight}px.`)
  check(bagCardWidth < 240 && bagOpenWidth < 200,`Bag Lootbox cards and Open buttons should stay narrow; widths were ${bagCardWidth}px / ${bagOpenWidth}px.`)
  check(await bagCard.getByRole('button',{name:'Send to Bag'}).count()===0,'Bag Lootbox cards must not offer Send to Bag.')
  await page.screenshot({path:path.join(outputDir,'02-bag.png'),fullPage:true})

  await page.getByRole('button',{name:'Back'}).click()
  await page.getByRole('button',{name:'Shop',exact:true}).click()
  await page.getByRole('tab',{name:'Lootbox Shop'}).click()
  const resetShopCard = page.locator('.lootbox-shop-card')
  await resetShopCard.getByRole('button',{name:'Purchase'}).waitFor()
  check(await resetShopCard.getByRole('button',{name:'Open Now'}).count()===0 && await resetShopCard.getByRole('button',{name:'Send to Bag'}).count()===0,'Sending a purchased Lootbox to the Bag must reset the shop card to Purchase.')

  await page.getByRole('button',{name:'Back'}).click()
  await page.getByRole('button',{name:'Bag',exact:true}).click()
  await page.getByRole('tab',{name:'Lootboxes'}).click()
  await page.locator('.lootbox-bag-card').getByRole('button',{name:'Open'}).waitFor()

  await page.reload({waitUntil:'networkidle'})
  await page.getByRole('tab',{name:'Lootboxes'}).click()
  await page.locator('.lootbox-bag-card').getByRole('button',{name:'Open'}).click()
  const modal = page.getByRole('dialog',{name:'Common Lootbox'})
  await modal.getByText('Possible rewards').waitFor()
  check(await modal.locator('.lootbox-pool-preview article').count()===5,'Lootbox detail must show all five possible rewards.')
  check(await page.evaluate(() => JSON.parse(window.render_game_to_text()).lootboxOpeningPhase === 'idle'),'Opening animation must remain idle until the user activates it.')
  const modalLayout = await page.evaluate(() => {
    const footer = document.querySelector('.lootbox-modal > footer')
    const pool = document.querySelector('.lootbox-modal > .lootbox-pool-preview')
    const modal = document.querySelector('.lootbox-modal')
    const bounds = modal?.getBoundingClientRect()
    return footer && pool ? {
      footerBeforePool: Boolean(footer.compareDocumentPosition(pool) & Node.DOCUMENT_POSITION_FOLLOWING),
      footerDisplay: getComputedStyle(footer).display,
      footerButtons: footer.querySelectorAll('button').length,
      modalWidth: bounds?.width ?? 0,
      modalHeight: bounds?.height ?? 0,
      footerButtonWidth: footer.querySelector('button')?.getBoundingClientRect().width ?? 0,
    } : null
  })
  check(modalLayout?.footerBeforePool && modalLayout.footerDisplay==='flex' && modalLayout.footerButtons===1 && modalLayout.modalWidth <= 820 && modalLayout.footerButtonWidth < 300 && await modal.getByRole('button',{name:'Send to Bag'}).count()===0,`Bag Lootbox popup must stay consistent and only offer Open Now: ${JSON.stringify(modalLayout)}`)
  await page.screenshot({path:path.join(outputDir,'03-popup-idle.png'),fullPage:true})
  await modal.locator('.lootbox-click-target').click()
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='reel',{timeout:5000})
  const reelModalLayout = await page.locator('.lootbox-modal').evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    const box = node.querySelector('.lootbox-opening-box-slot')?.getBoundingClientRect()
    const reel = node.querySelector('.lootbox-opening-reel-slot')?.getBoundingClientRect()
    const result = node.querySelector('.lootbox-opening-result-slot')?.getBoundingClientRect()
    return { width: bounds.width, height: bounds.height, boxTop: box?.top ?? 0, reelTop: reel?.top ?? 0, resultTop: result?.top ?? 0 }
  })
  check(reelModalLayout.width === modalLayout.modalWidth && reelModalLayout.height === modalLayout.modalHeight,`Opening popup changed size between idle and reel: ${JSON.stringify({ idle: modalLayout, reel: reelModalLayout })}`)
  await page.screenshot({path:path.join(outputDir,'04-reel.png'),fullPage:true})
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='result',{timeout:9000})
  await page.waitForTimeout(500)
  const resultModalLayout = await page.locator('.lootbox-modal').evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    const box = node.querySelector('.lootbox-opening-box-slot')?.getBoundingClientRect()
    const reel = node.querySelector('.lootbox-opening-reel-slot')?.getBoundingClientRect()
    const result = node.querySelector('.lootbox-opening-result-slot')?.getBoundingClientRect()
    return { width: bounds.width, height: bounds.height, boxTop: box?.top ?? 0, reelTop: reel?.top ?? 0, resultTop: result?.top ?? 0 }
  })
  check(resultModalLayout.width === reelModalLayout.width && resultModalLayout.height === reelModalLayout.height && resultModalLayout.boxTop === reelModalLayout.boxTop && resultModalLayout.reelTop === reelModalLayout.reelTop && resultModalLayout.resultTop === reelModalLayout.resultTop,`Opening slots shifted between reel and result: ${JSON.stringify({ reel: reelModalLayout, result: resultModalLayout })}`)
  const winningAmount = await page.locator('.lootbox-reel-cell.winner strong').textContent()
  const resultAmount = await page.locator('.lootbox-reward-amount').textContent()
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
  await page.screenshot({path:path.join(outputDir,'05-result.png'),fullPage:true})
  const openingCount = await admin.from('lootbox_openings').select('id',{count:'exact',head:true}).eq('user_id',userId)
  check(openingCount.count===1,'Opening animation must correspond to exactly one persisted backend opening.')

  await modal.getByRole('button',{name:'Continue'}).click()
  await page.getByRole('button',{name:'Back'}).click()
  await page.getByRole('button',{name:'Shop',exact:true}).click()
  await page.getByRole('tab',{name:'Lootbox Shop'}).click()
  const secondShopCard = page.locator('.lootbox-shop-card')
  await secondShopCard.getByRole('button',{name:'Purchase'}).waitFor()
  check(await secondShopCard.getByRole('button',{name:'Open Now'}).count()===0 && await secondShopCard.getByRole('button',{name:'Send to Bag'}).count()===0,'Opening a Lootbox must reset the shop card to Purchase.')
  await secondShopCard.getByRole('button',{name:'Purchase'}).click()
  const secondModal = page.getByRole('dialog',{name:'Common Lootbox'})
  await secondModal.getByText('Possible rewards').waitFor()
  check(await page.evaluate(() => JSON.parse(window.render_game_to_text()).lootboxOpeningPhase === 'idle'),'A newly purchased Lootbox must wait for activation.')
  await secondModal.getByRole('button',{name:/Purchase/}).click()
  await secondModal.getByRole('button',{name:'Open Now'}).waitFor()
  await secondModal.getByRole('button',{name:'Open Now'}).focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='reel',{timeout:5000})
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='result',{timeout:9000})
  const finalOpeningCount = await admin.from('lootbox_openings').select('id',{count:'exact',head:true}).eq('user_id',userId)
  check(finalOpeningCount.count===2,'Space activation must consume exactly one additional persisted Lootbox.')
  check(!errors.length,`Browser errors: ${errors.join(' | ')}`)
  console.log(`Lootbox browser flow passed. Screenshots: ${outputDir}`)
} finally {
  await browser?.close().catch(()=>undefined)
  await player.auth.signOut().catch(()=>undefined)
  if(userId) await admin.auth.admin.deleteUser(userId).catch(()=>undefined)
}
