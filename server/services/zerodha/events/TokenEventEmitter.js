/**
 * Token Event Emitter
 * Implements Observer Pattern for token-related events
 */

import { EventEmitter } from 'events';

export class TokenEventEmitter extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.setupEventLogging();
  }

  /**
   * Set up automatic event logging
   */
  setupEventLogging() {
    // Log all token events
    this.on('token.expired', (data) => {
      this.logger.info('Token expired event', data);
    });

    this.on('token.nearExpiration', (data) => {
      this.logger.info('Token near expiration event', data);
    });

    this.on('token.renewal.started', (data) => {
      this.logger.info('Token renewal started event', data);
    });

    this.on('token.renewal.completed', (data) => {
      this.logger.info('Token renewal completed event', data);
    });

    this.on('token.renewal.failed', (data) => {
      this.logger.error('Token renewal failed event', data);
    });

    this.on('websocket.connected', (data) => {
      this.logger.info('WebSocket connected event', data);
    });

    this.on('websocket.disconnected', (data) => {
      this.logger.info('WebSocket disconnected event', data);
    });

    this.on('websocket.reconnected', (data) => {
      this.logger.info('WebSocket reconnected event', data);
    });

    this.on('websocket.error', (data) => {
      this.logger.error('WebSocket error event', data);
    });

    this.on('websocket.tick', (data) => {
      this.logger.debug('WebSocket tick event', data);
    });
  }

  /**
   * Emit token expired event
   * @param {Object} data - Event data
   */
  emitTokenExpired(data) {
    this.emit('token.expired', data);
  }

  /**
   * Emit token near expiration event
   * @param {Object} data - Event data
   */
  emitTokenNearExpiration(data) {
    this.emit('token.nearExpiration', data);
  }

  /**
   * Emit token renewal started event
   * @param {Object} data - Event data
   */
  emitTokenRenewalStarted(data) {
    this.emit('token.renewal.started', data);
  }

  /**
   * Emit token renewal completed event
   * @param {Object} data - Event data
   */
  emitTokenRenewalCompleted(data) {
    this.emit('token.renewal.completed', data);
  }

  /**
   * Emit token renewal failed event
   * @param {Object} data - Event data
   */
  emitTokenRenewalFailed(data) {
    this.emit('token.renewal.failed', data);
  }

  /**
   * Emit WebSocket connected event
   * @param {Object} data - Event data
   */
  emitWebSocketConnected(data) {
    this.emit('websocket.connected', data);
  }

  /**
   * Emit WebSocket disconnected event
   * @param {Object} data - Event data
   */
  emitWebSocketDisconnected(data) {
    this.emit('websocket.disconnected', data);
  }

  /**
   * Emit WebSocket reconnected event
   * @param {Object} data - Event data
   */
  emitWebSocketReconnected(data) {
    this.emit('websocket.reconnected', data);
  }

  /**
   * Emit WebSocket error event
   * @param {Object} data - Event data
   */
  emitWebSocketError(data) {
    this.emit('websocket.error', data);
  }

  /**
   * Get event statistics
   * @returns {Object} - Event statistics
   */
  getEventStats() {
    return {
      listenerCount: this.listenerCount(),
      eventNames: this.eventNames(),
      maxListeners: this.getMaxListeners()
    };
  }
}
