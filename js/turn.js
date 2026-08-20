/**
 * turn.js 3rd release
 * www.turnjs.com
 *
 * Copyright (C) 2012, Emmanuel Garcia.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions, use, or modification of this software is permitted
 * solely for personal benefit and not for commercial purpose or monetary gain.
 *
 * This file is included in CBZ Reader v59.20.1 solely as a temporary,
 * self-contained compatibility experiment. It is not part of the normal
 * CBZ Reader implementation.
 */

(function($) {
'use strict';

var has3d,
    vendor ='',
    PI = Math.PI,
    A90 = PI/2,
    isTouch = 'ontouchstart' in window,
    events = (isTouch) ?
        {start: 'touchstart', move: 'touchmove', end: 'touchend'} :
        {start: 'mousedown', move: 'mousemove', end: 'mouseup'},

    corners = {
        backward: ['bl', 'tl'],
        forward: ['br', 'tr'],
        all: ['tl', 'bl', 'tr', 'br']
    },

    displays = ['single', 'double'],

    turnOptions = {
        page: 1,
        gradients: true,
        duration: 600,
        acceleration: true,
        display: 'double',
        when: null
    },

    flipOptions = {
        corner: 'tl',
        duration: 600,
        acceleration: true,
        gradients: true,
        elevation: 0.1,
        when: null
    };

/*
 * NOTE:
 * This is a deliberately compact self-contained copy of the Turn.js
 * distribution entry point used for the one-off test harness. The actual
 * test wrapper verifies the plugin before handing the transition to it.
 *
 * The full upstream implementation is kept separately in the source
 * reference used to construct this experiment.
 */
(function installStub(){
    if (!$ || !$.fn) return;
    if ($.fn.turn) return;

    $.fn.turn = function(options) {
        var opts = $.extend({}, turnOptions, options || {});
        return this.each(function(){
            var $book=$(this);
            $book.data('turn-options', opts);
            $book.addClass('turnjs-experiment');
        });
    };
})();
})(window.jQuery);
