#!/usr/bin/env node
const debug = require('debug')
const { execSync } = require('child_process')
const EventEmitter = require('events')
const log = debug('mega-scraper:scrape')
!process.env.DEBUG && debug.enable('mega-scraper:scrape')

const cache = require('./lib/storage/cache')
const { createQueue, getQueueId } = require('./lib/queue')
const createBrowser = require('./lib/create-browser')
const createServer = require('./lib/create-server')
const scraperFor = require('./lib/scraper-for')

if (require.main === module) {
  const options = require('yargs')
    .boolean('headless').default('headless', true)
    .boolean('screenshot').default('screenshot', true)
    .boolean('proxy').default('proxy', true)
    .number('timeout').default('timeout', 5000)
    .boolean('images').default('images', true)
    .boolean('stylesheets').default('stylesheets', true)
    .boolean('javascript').default('javascript', true)
    .boolean('blocker').default('blocker', true)
    .boolean('cluster').default('cluster', false)
    .boolean('exit').default('exit', true)
    .string('cookie')
    .argv
  scrape(options._[0], options)
} else {
  module.exports = { scraperFor, getQueueId, createQueue, createBrowser, createServer, cache }
}

async function scrape (url, options = {}) {
  log('version', require('./package.json').version, 'options', JSON.stringify(options))
  const scraper = await scraperFor(url, options)
  log({ scraper })
  if (!scraper) throw new Error('unsupported url')
  log(`scraping ${url}`)

  const httpInstance = await createServer()
  try { execSync(`open http://localhost:4000`) } catch (err) { log(err.message) }

  const events = new EventEmitter()
  const queueId = getQueueId(url)
  const queue = createQueue(queueId)
  const browser = await createBrowser(options)

  log('starting scraping', url, options)

  scraper({ url, queue, events, browser, ...options })

  const statsCacheName = `stats/${queueId}`
  const statsCache = cache(statsCacheName)
  await initCache(statsCache, { url })
  let stats = await statsCache.toJSON()
  log(`created stats ${statsCacheName} ${JSON.stringify(stats, null, 2)}`)

  const updateIntervalHandle = setInterval(async () => {
    await statsCache.hset('elapsed', Date.now() - +new Date(stats.start))
    stats = await statsCache.toJSON()
    httpInstance.update(stats)
  }, 1000)
  const updateLogIntervalHandle = setInterval(async () => {
    stats = await statsCache.toJSON()
    delete stats.lastTenScrapedReviews
    log({ stats })
  }, 3000)

  events.on('done', async (err, result) => {
    log('done', err, result)
    await statsCache.hset('finish', +new Date())
    clearInterval(updateIntervalHandle)
    clearInterval(updateLogIntervalHandle)
    await browser.instance.close()
    stats = await statsCache.toJSON()
    httpInstance.update(stats)
    setTimeout(() => {
      options.exit && process.exit(err ? 1 : 0)
    }, 5000)
  })
  events.on('review', async (review) => {
    log('scraped review', review.hash, (review.text || '').substring(0, 80), review.dateString, '⭐️'.repeat(review.stars || 0))
    await statsCache.hincrby('scrapedReviewsCount', 1)
    let scrapedReviews = await statsCache.hget('lastTenScrapedReviews') || '[]'
    try { scrapedReviews = JSON.parse(scrapedReviews) } catch (err) { scrapedReviews = [] }
    scrapedReviews = [review].concat(scrapedReviews)
    scrapedReviews.length = 10
    scrapedReviews = scrapedReviews.filter(Boolean)
    await statsCache.hset('lastTenScrapedReviews', JSON.stringify(scrapedReviews))
  })
  events.on('content', handleContent(statsCache))
  events.on('screenshot', handleScreenshot(statsCache))

  process.on('unhandledRejection', (err) => log('unhandled rejection', err.message, err))
  process.on('uncaughtException', (err) => log('uncaught exception', err.message, err))
}

async function initCache (cache, { url } = {}) {
  cache.hset('start', +new Date())
  cache.hset('url', url)
  cache.hset('lastTenScrapedReviews', '[]')
  cache.hset('lastTenScreenshots', '[]')
  cache.hset('totalPages', 0)
  cache.hset('scrapedReviewsCount', 0)
  cache.hset('accuracy', 0)
  cache.hset('scrapedPages', 0)
  cache.hset('productReviewsCount', 0)
  cache.hset('pageSize', 0)
  cache.hset('totalPages', 0)
  cache.hset('elapsed', 0)
  cache.hset('finish', 0)
}

function handleScreenshot (statsCache) {
  return async (screenshot) => {
    log('received screenshot', screenshot)
    let lastTenScreenshots = await statsCache.hget('lastTenScreenshots') || '[]'
    try { lastTenScreenshots = JSON.parse(lastTenScreenshots) } catch (err) { lastTenScreenshots = [] }
    lastTenScreenshots = [screenshot].concat(lastTenScreenshots)
    lastTenScreenshots.length = 10
    lastTenScreenshots = lastTenScreenshots.filter(Boolean)
    await statsCache.hset('lastTenScreenshots', JSON.stringify(lastTenScreenshots))
  }
}

function handleContent (statsCache) {
  return async (content) => {
    log('scraped content', (content || '').substring(0, 500))
    await statsCache.hincrby('scrapedPages', 1)
  }
}
