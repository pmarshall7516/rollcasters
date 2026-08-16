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
  const page = await browser.newPage({viewport:{width:Number(process.env.VIEWPORT_WIDTH ?? 1440),height:Number(process.env.VIEWPORT_HEIGHT ?? 900)}})
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
  const shopCard = page.locator('.lootbox-shop-card').filter({hasText:/\bCommon Lootbox\b/})
  await shopCard.waitFor()
  const displayedPrice = Number((await shopCard.locator('.lootbox-shop-price .shop-price-cost').textContent()).replace(/[^0-9]/g,''))
  check(Number.isSafeInteger(displayedPrice) && displayedPrice > 0,`Lootbox Shop must display a valid integer price: ${displayedPrice}.`)
  await page.screenshot({path:path.join(outputDir,'01-shop-grid.png'),fullPage:true})
  const cardHeight = await shopCard.evaluate((node)=>node.getBoundingClientRect().height)
  const shopCardWidth = await shopCard.evaluate((node)=>node.getBoundingClientRect().width)
  const shopPurchaseWidth = await shopCard.getByRole('button',{name:'Purchase'}).evaluate((node)=>node.getBoundingClientRect().width)
  check(cardHeight >= 400,`Lootbox shop cards should use the shared Shop card height; height was ${cardHeight}px.`)
  check(shopCardWidth <= 260 && shopPurchaseWidth < 200,`Lootbox shop cards and Purchase buttons should stay within the shared Shop width; widths were ${shopCardWidth}px / ${shopPurchaseWidth}px.`)
  const infoButton = shopCard.getByRole('button',{name:'View Common Lootbox details'})
  check(await infoButton.count() === 1, 'Each Lootbox Shop card must expose one top-right info button.')
  const infoLayout = await infoButton.evaluate((node) => {
    const card = node.closest('.lootbox-shop-card')
    const button = node.getBoundingClientRect()
    const cardBounds = card?.getBoundingClientRect()
    return { topOffset: button.top - (cardBounds?.top ?? 0), rightOffset: (cardBounds?.right ?? 0) - button.right, width: button.width, height: button.height }
  })
  check(infoLayout.topOffset <= 12 && infoLayout.rightOffset <= 12 && infoLayout.width === infoLayout.height && infoLayout.width <= 34, `Lootbox info button must be a small top-right circle: ${JSON.stringify(infoLayout)}`)
  await infoButton.click()
  const infoModal = page.getByRole('dialog',{name:'Common Lootbox'})
  await infoModal.getByText('Possible rewards').waitFor()
  check(await page.evaluate(() => JSON.parse(window.render_game_to_text()).lootboxOpeningPhase === 'idle'), 'The Lootbox info button must open the idle details popup.')
  await infoModal.getByRole('button',{name:'Close'}).click()
  const spriteControls = await shopCard.locator('.lootbox-card-sprite').evaluate((node)=>node.querySelectorAll('button,input,select,textarea,[tabindex]').length)
  check(spriteControls===0,'Shop card sprites must not contain keyboard-focusable controls.')
  await shopCard.locator('.lootbox-card-sprite').click()
  const spriteModal = page.getByRole('dialog',{name:'Common Lootbox'})
  await spriteModal.getByText('Possible rewards').waitFor()
  await spriteModal.getByRole('button',{name:'Close'}).click()
  await shopCard.getByRole('button',{name:'Purchase'}).click()
  const purchaseModal = page.getByRole('dialog',{name:'Common Lootbox'})
  await purchaseModal.getByText('Possible rewards').waitFor()
  const purchaseModalWidth = await purchaseModal.evaluate((node)=>node.getBoundingClientRect().width)
  check(purchaseModalWidth <= 820,`Lootbox shop popup should fit the fixed opening footprint; width was ${purchaseModalWidth}px.`)
  check(await page.evaluate(() => JSON.parse(window.render_game_to_text()).lootboxOpeningPhase === 'idle'),'The shop-grid Purchase button should open an idle popup.')
  check(await purchaseModal.locator('.shop-quantity-input').count()===1 && await purchaseModal.getByRole('button',{name:'Purchase'}).count()===1,'The shop-grid Purchase button must open the purchase popup with its quantity control.')
  check(await purchaseModal.locator('.lootbox-modal-currencies .currency-pill').count()>0,'Lootbox purchase popup must keep currency balances visible.')
  const purchaseQuantity = 3
  const increaseQuantity = purchaseModal.getByRole('button',{name:/Increase quantity of/i})
  await increaseQuantity.click()
  await increaseQuantity.click()
  check((await purchaseModal.locator('.shop-quantity-input').textContent())?.trim()===String(purchaseQuantity),'Lootbox quantity must change only through the plus/minus controls.')
  const popupDisplayedPrice = Number((await purchaseModal.locator('.lootbox-modal-purchase-price .shop-price-cost').textContent()).replace(/[^0-9]/g,''))
  check(popupDisplayedPrice === displayedPrice * purchaseQuantity,`Lootbox popup price must scale with quantity: ${popupDisplayedPrice} vs ${displayedPrice * purchaseQuantity}.`)
  const shardShape = await purchaseModal.locator('.lootbox-pool-shard-art .shard-sprite-frame').first().evaluate((node) => ({
    clipPath: getComputedStyle(node).clipPath,
    aspectRatio: getComputedStyle(node).aspectRatio,
  }))
  check(shardShape.clipPath.includes('polygon') && shardShape.aspectRatio.includes('1.7'),`Lootbox shard art must use the shared diamond sprite frame: ${JSON.stringify(shardShape)}`)
  await page.screenshot({path:path.join(outputDir,'01-purchase-popup.png'),fullPage:true})
  await purchaseModal.getByRole('button',{name:'Purchase'}).click()
  await purchaseModal.getByRole('button',{name:'Open Now'}).waitFor()
  await purchaseModal.getByRole('button',{name:'Send to Bag'}).waitFor()
  await shopCard.getByRole('button',{name:'Open Now'}).waitFor()
  await shopCard.getByRole('button',{name:'Send to Bag'}).waitFor()
  check(await page.evaluate(() => JSON.parse(window.render_game_to_text()).unsavedShopPurchases)===1,'Popup Purchase must enter the local Shop ledger immediately.')
  const purchasedInventory = await player.from('user_lootboxes').select('lootbox_id,quantity').eq('lootbox_id','001').gt('quantity',0).maybeSingle()
  if (purchasedInventory.error) throw purchasedInventory.error
  check(!purchasedInventory.data,'Popup Purchase must remain local until the player leaves Shop.')
  const chargedBalance = await player.from('user_currencies').select('balance').eq('user_id',userId).eq('currency_id','coins').single()
  if (chargedBalance.error) throw chargedBalance.error
  check(String(chargedBalance.data.balance) === '500',`The saved balance must remain unchanged while the Shop ledger is local; balance was ${chargedBalance.data.balance}.`)

  await purchaseModal.getByRole('button',{name:'Send to Bag'}).click()
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === 'shop', { timeout: 10000 })
  await page.getByRole('heading',{name:'Shop',exact:true}).waitFor()
  check(await page.locator('.lootbox-shop-card').getByRole('button',{name:'Purchase'}).count()===1,'Sending a purchased Lootbox to the Bag must keep the user on the Lootbox Shop.')

  await page.getByRole('button',{name:'Back',exact:true}).click()
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).unsavedShopPurchases === 0, { timeout: 10000 })
  const persistedInventory = await player.from('user_lootboxes').select('lootbox_id,quantity').eq('lootbox_id','001').gt('quantity',0).single()
  if (persistedInventory.error) throw persistedInventory.error
  check(String(persistedInventory.data.quantity) === String(purchaseQuantity),'Leaving Shop must atomically persist the full local Lootbox quantity.')
  const persistedBalance = await player.from('user_currencies').select('balance').eq('user_id',userId).eq('currency_id','coins').single()
  if (persistedBalance.error) throw persistedBalance.error
  check(String(persistedBalance.data.balance) === String(500 - popupDisplayedPrice),'Leaving Shop must atomically persist the matching currency debit.')
  await page.getByRole('button',{name:'Bag',exact:true}).click()
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
  check(await modal.locator('.lootbox-modal-currencies .currency-pill').count()===0,'Bag Lootbox popup must hide currency balances.')
  check(await page.evaluate(() => JSON.parse(window.render_game_to_text()).lootboxOpeningPhase === 'idle'),'Opening animation must remain idle until the user activates it.')
  const modalLayout = await page.evaluate(() => {
    const footer = document.querySelector('.lootbox-modal > footer')
    const pool = document.querySelector('.lootbox-modal > .lootbox-pool-preview')
    const modal = document.querySelector('.lootbox-modal')
    const bounds = modal?.getBoundingClientRect()
    const poolGrid = pool?.querySelector(':scope > div')
    const closedSprite = modal?.querySelector('.lootbox-sprite.closed')
    return footer && pool ? {
      footerBeforePool: Boolean(footer.compareDocumentPosition(pool) & Node.DOCUMENT_POSITION_FOLLOWING),
      footerDisplay: getComputedStyle(footer).display,
      footerButtons: footer.querySelectorAll('button').length,
      modalWidth: bounds?.width ?? 0,
      modalHeight: bounds?.height ?? 0,
      footerButtonWidth: footer.querySelector('button')?.getBoundingClientRect().width ?? 0,
      poolBottomPadding: Number.parseFloat(getComputedStyle(pool).paddingBottom),
      poolBottomGap: (pool?.getBoundingClientRect().bottom ?? 0) - (poolGrid?.getBoundingClientRect().bottom ?? 0),
      closedSpriteTransform: getComputedStyle(closedSprite).transform,
    } : null
  })
  check(modalLayout?.footerBeforePool && modalLayout.footerDisplay==='flex' && modalLayout.footerButtons===1 && modalLayout.modalWidth <= 820 && modalLayout.footerButtonWidth < 300 && modalLayout.poolBottomPadding >= 12 && modalLayout.poolBottomGap >= 12 && modalLayout.closedSpriteTransform !== 'none' && await modal.getByRole('button',{name:'Send to Bag'}).count()===0,`Bag Lootbox popup must stay consistent and only offer Open Now: ${JSON.stringify(modalLayout)}`)
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
  const winningName = await page.locator('.lootbox-reel-cell.winner small').textContent()
  const resultLabel = await page.locator('.lootbox-result > span').textContent()
  const resultText = await page.locator('.lootbox-result h3').textContent()
  const expectedResultText = `x${(winningAmount ?? '').replace(/^×/,'')} ${winningName}`
  check(resultLabel==='YOU WON' && resultText===expectedResultText,`Lootbox reward text ${resultLabel} ${resultText} did not match the predetermined reward YOU WON ${expectedResultText}.`)
  const rewardType = await page.locator('.lootbox-result').getAttribute('data-reward-type')
  if (rewardType === 'shard' || rewardType === 'relic') {
    const rewardProgress = page.locator('[data-lootbox-reward-progress]')
    await rewardProgress.waitFor()
    check(await rewardProgress.getAttribute('data-lootbox-reward-progress')===rewardType,`Expected a ${rewardType} reward progress bar.`)
    check(await rewardProgress.getByRole('progressbar').count()===1,'Lootbox reward progress must expose one accessible progress bar.')
      check((await rewardProgress.locator('.xp-bar > span').evaluate((node)=>getComputedStyle(node).transitionProperty)).includes('width'),'Lootbox reward progress must animate its fill continuously.')
      if (await rewardProgress.locator('.lootbox-progress-duplicate').count() > 0) check(await rewardProgress.getAttribute('data-lootbox-reward-capped') === 'true','Duplicate shard or relic rewards must mark the progress bar as capped.')
  }
  const firstOpenAnother = modal.getByRole('button',{name:`Open Another (${purchaseQuantity - 1} left)`})
  await firstOpenAnother.waitFor()
  check(await modal.getByRole('button',{name:'Back'}).count()===1,'Lootbox results must show Back beside Open Another.')
  await firstOpenAnother.click()
  const immediateOpenAnotherState = await page.evaluate(() => ({
    phase: JSON.parse(window.render_game_to_text()).lootboxOpeningPhase,
    showingIdlePopup: Boolean(document.querySelector('.lootbox-pool-preview')),
  }))
  check(immediateOpenAnotherState.phase !== 'idle' && !immediateOpenAnotherState.showingIdlePopup,`Open Another must enter the opening sequence without rendering the idle popup: ${JSON.stringify(immediateOpenAnotherState)}`)
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='reel',{timeout:5000})
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='result',{timeout:9000})
  const secondOpenAnother = modal.getByRole('button',{name:`Open Another (${purchaseQuantity - 2} left)`})
  await secondOpenAnother.waitFor()
  await secondOpenAnother.click()
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='reel',{timeout:5000})
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='result',{timeout:9000})
  await modal.getByRole('button',{name:'Back'}).waitFor()
  check(await modal.getByRole('button',{name:/Open Another/}).count()===0,'The final Lootbox result must only show Back when no boxes remain.')
  const continueBounds = await modal.getByRole('button',{name:'Back'}).evaluate((node) => {
    const button = node.getBoundingClientRect()
    const dialog = node.closest('.lootbox-modal')?.getBoundingClientRect()
    const resultSlot = node.closest('.lootbox-opening-result-slot')?.getBoundingClientRect()
    return { buttonBottom: button.bottom, dialogBottom: dialog?.bottom ?? 0, resultSlotBottom: resultSlot?.bottom ?? 0 }
  })
  check(continueBounds.buttonBottom <= continueBounds.dialogBottom + 1 && continueBounds.buttonBottom <= continueBounds.resultSlotBottom + 1,`Lootbox result content overflowed the popup or its result slot: ${JSON.stringify(continueBounds)}`)
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
  check(openingCount.count===purchaseQuantity,'Opening animation must correspond to one persisted backend opening per consumed Lootbox.')

  await modal.getByRole('button',{name:'Back'}).click()
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
  await secondModal.getByRole('button',{name:'Purchase'}).click()
  await secondModal.getByRole('button',{name:'Open Now'}).waitFor()
  await secondModal.getByRole('button',{name:'Open Now'}).focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='reel',{timeout:5000})
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).lootboxOpeningPhase==='result',{timeout:9000})
  await page.waitForTimeout(500)
  await page.screenshot({path:path.join(outputDir,'06-second-result.png'),fullPage:true})
  const finalOpeningCount = await admin.from('lootbox_openings').select('id',{count:'exact',head:true}).eq('user_id',userId)
  check(finalOpeningCount.count===purchaseQuantity + 1,'Space activation must consume exactly one additional persisted Lootbox.')
  check(!errors.length,`Browser errors: ${errors.join(' | ')}`)
  console.log(`Lootbox browser flow passed. Screenshots: ${outputDir}`)
} finally {
  await browser?.close().catch(()=>undefined)
  await player.auth.signOut().catch(()=>undefined)
  if(userId) await admin.auth.admin.deleteUser(userId).catch(()=>undefined)
}
