module.exports = require('yargs')
  .boolean('headless').default('headless', true)
  .boolean('screenshot').default('screenshot', true)
  .boolean('proxy').default('proxy', true)
  .number('timeout').default('timeout', 5000)
  .boolean('images').default('images', true)
  .boolean('stylesheets').default('stylesheets', true)
  .boolean('javascript').default('javascript', true)
  .boolean('blocker').default('blocker', true)
  .boolean('cluster').default('cluster', false)
  .boolean('exit').default('exit', false)
  .string('cookie')
  .argv
