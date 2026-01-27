/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan
 */

const { prisma } = require('../models/prisma')

exports.list = async (req, res, next) => {
  try {
    const { DateTime } = require('luxon')
    // By default only show unresolved alerts (resolved = 0), unless ?all=true
    const showAll = req.query.all === 'true'
    
    const alerts = await prisma.alert.findMany({
      where: showAll ? {} : { resolved: 0 },
      include: { 
        type: true, 
        priority: true, 
        product: { include: { category: true } }, 
        status: true, 
        assignedTo: true 
      },
      orderBy: { timestamp: 'desc' },
      take: 100,
    })
    
    // Format timestamps to friendly Guatemala local time
    const adapted = alerts.map(a => {
      let friendlyTimestamp = ''
      if (a.timestamp) {
        // Convert from UTC to Guatemala time (CST, UTC-6)
        const gtTime = DateTime.fromJSDate(a.timestamp, { zone: 'utc' })
          .setZone('America/Guatemala')
          .setLocale('es')
        friendlyTimestamp = gtTime.toFormat("dd LLL yyyy HH:mm")
      }
      return {
        ...a,
        timestamp: friendlyTimestamp,
      }
    })
    res.json(adapted)
  } catch (e) { next(e) }
}

exports.create = async (req, res, next) => {
  try {
    const created = await prisma.alert.create({ data: req.body })
    res.status(201).json(created)
  } catch (e) { next(e) }
}

// Reasignar alerta a otro usuario (admin)
exports.assign = async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_id } = req.body || {}
    if (!user_id) return res.status(400).json({ message: 'user_id requerido' })
    const updated = await prisma.alert.update({
      where: { id },
      data: { assignedTo: { connect: { id: String(user_id) } } },
      include: { assignedTo: true }
    })
    res.json(updated)
  } catch (e) { next(e) }
}

// Marcar alerta como resuelta
exports.resolve = async (req, res, next) => {
  try {
    const { id } = req.params
    const updated = await prisma.alert.update({
      where: { id },
      data: { resolved: 1 },
      include: { 
        type: true, 
        priority: true, 
        product: { include: { category: true } }, 
        status: true, 
        assignedTo: true 
      }
    })
    res.json(updated)
  } catch (e) { next(e) }
}
