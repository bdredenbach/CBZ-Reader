(module
  ;; 64 pages = 4 MiB: enough for one 900 x 900 Float32 luminance plane
  ;; plus the fixed result record. The module never grows its memory.
  (memory (export "memory") 64 64)

  (func (export "evaluate")
    (param $horizontal i32) (param $negative i32)
    (param $w i32) (param $h i32)
    (param $tx f64) (param $ty f64)
    (param $tapCross f64) (param $seedCross f64)
    (param $outward f64) (param $inward f64)
    (param $a0 i32) (param $a1 i32) (param $step i32)
    (param $crossSpan f64) (param $alongSpan f64)
    (param $m f64) (param $anchor f64) (param $outPtr i32)
    (result i32)

    (local $dimCross i32) (local $a i32)
    (local $pc i32) (local $pa i32) (local $pb i32)
    (local $n i32) (local $dark i32) (local $strong i32)
    (local $longest i32) (local $run i32) (local $segments i32)
    (local $inSeg i32) (local $contrastHits i32)
    (local $bestStart i32) (local $bestEnd i32)
    (local $segmentStart i32) (local $lastSegmentDark i32)
    (local $bestLen i32) (local $contrastOffset i32) (local $maxGap i32)
    (local $b f64) (local $atTap f64) (local $p f64)
    (local $v f64) (local $va f64) (local $vb f64)
    (local $ca f64) (local $cb f64) (local $contrast f64)
    (local $contrastSum f64) (local $balancedHits f64)
    (local $support f64) (local $continuity f64) (local $strongRate f64)
    (local $contrastRate f64) (local $balancedRate f64) (local $contrastMean f64)
    (local $outwardDist f64) (local $nearestPenalty f64)
    (local $fragmentationPenalty f64) (local $score f64)

    (local.set $dimCross
      (if (result i32) (local.get $horizontal)
        (then (local.get $h)) (else (local.get $w))))
    (local.set $b
      (f64.sub (local.get $anchor)
        (f64.mul (local.get $m)
          (if (result f64) (local.get $horizontal)
            (then (local.get $tx)) (else (local.get $ty))))))
    (local.set $atTap
      (f64.add
        (f64.mul (local.get $m)
          (if (result f64) (local.get $horizontal)
            (then (local.get $tx)) (else (local.get $ty))))
        (local.get $b)))

    (if (i32.and (local.get $negative)
          (f64.ge (local.get $atTap) (f64.sub (local.get $tapCross) (f64.const 4))))
      (then (return (i32.const 0))))
    (if (i32.and (i32.eqz (local.get $negative))
          (f64.le (local.get $atTap) (f64.add (local.get $tapCross) (f64.const 4))))
      (then (return (i32.const 0))))
    (if (i32.and (local.get $negative)
          (f64.gt (local.get $atTap) (f64.add (local.get $seedCross) (local.get $inward))))
      (then (return (i32.const 0))))
    (if (i32.and (i32.eqz (local.get $negative))
          (f64.lt (local.get $atTap) (f64.sub (local.get $seedCross) (local.get $inward))))
      (then (return (i32.const 0))))

    (local.set $contrastOffset
      (i32.trunc_f64_s
        (f64.floor
          (f64.add (f64.const 0.5)
            (f64.max (f64.const 3)
              (f64.min (f64.const 8)
                (f64.mul (local.get $crossSpan) (f64.const 0.025))))))))
    (local.set $maxGap
      (select
        (i32.mul (local.get $step) (i32.const 3))
        (i32.const 8)
        (i32.gt_s (i32.mul (local.get $step) (i32.const 3)) (i32.const 8))))
    (local.set $bestStart (i32.const -1))
    (local.set $bestEnd (i32.const -1))
    (local.set $segmentStart (i32.const -1))
    (local.set $lastSegmentDark (i32.const -1))
    (local.set $bestLen (i32.const -1))
    (local.set $a (local.get $a0))

    (block $done
      (loop $sample
        (br_if $done (i32.gt_s (local.get $a) (local.get $a1)))
        (local.set $p
          (f64.add
            (f64.mul (local.get $m) (f64.convert_i32_s (local.get $a)))
            (local.get $b)))
        (if (i32.or
              (f64.lt (local.get $p) (f64.const 2))
              (f64.ge (local.get $p)
                (f64.convert_i32_s (i32.sub (local.get $dimCross) (i32.const 2)))))
          (then
            (local.set $run (i32.const 0))
            (local.set $inSeg (i32.const 0))
            (local.set $a (i32.add (local.get $a) (local.get $step)))
            (br $sample)))

        (local.set $pc
          (i32.trunc_f64_s (f64.floor (f64.add (local.get $p) (f64.const 0.5)))))
        (local.set $pa
          (i32.trunc_f64_s
            (f64.floor
              (f64.add
                (f64.sub (local.get $p) (f64.convert_i32_s (local.get $contrastOffset)))
                (f64.const 0.5)))))
        (local.set $pb
          (i32.trunc_f64_s
            (f64.floor
              (f64.add
                (f64.add (local.get $p) (f64.convert_i32_s (local.get $contrastOffset)))
                (f64.const 0.5)))))
        (local.set $pc
          (select (i32.const 1)
            (select
              (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pc)
              (i32.lt_s (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pc)))
            (i32.gt_s (i32.const 1)
              (select
                (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pc)
                (i32.lt_s (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pc))))))
        (local.set $pa
          (select (i32.const 1)
            (select
              (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pa)
              (i32.lt_s (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pa)))
            (i32.gt_s (i32.const 1)
              (select
                (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pa)
                (i32.lt_s (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pa))))))
        (local.set $pb
          (select (i32.const 1)
            (select
              (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pb)
              (i32.lt_s (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pb)))
            (i32.gt_s (i32.const 1)
              (select
                (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pb)
                (i32.lt_s (i32.sub (local.get $dimCross) (i32.const 2)) (local.get $pb))))))

        (local.set $v
          (f64.promote_f32
            (f32.load
              (i32.mul (i32.const 4)
                (if (result i32) (local.get $horizontal)
                  (then (i32.add (i32.mul (local.get $pc) (local.get $w)) (local.get $a)))
                  (else (i32.add (i32.mul (local.get $a) (local.get $w)) (local.get $pc))))))))
        (local.set $va
          (f64.promote_f32
            (f32.load
              (i32.mul (i32.const 4)
                (if (result i32) (local.get $horizontal)
                  (then (i32.add (i32.mul (local.get $pa) (local.get $w)) (local.get $a)))
                  (else (i32.add (i32.mul (local.get $a) (local.get $w)) (local.get $pa))))))))
        (local.set $vb
          (f64.promote_f32
            (f32.load
              (i32.mul (i32.const 4)
                (if (result i32) (local.get $horizontal)
                  (then (i32.add (i32.mul (local.get $pb) (local.get $w)) (local.get $a)))
                  (else (i32.add (i32.mul (local.get $a) (local.get $w)) (local.get $pb))))))))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (local.set $ca (f64.sub (local.get $va) (local.get $v)))
        (local.set $cb (f64.sub (local.get $vb) (local.get $v)))
        (local.set $contrast
          (f64.div (f64.add (local.get $ca) (local.get $cb)) (f64.const 2)))
        (if (f64.ge (local.get $contrast) (f64.const 10))
          (then (local.set $contrastHits (i32.add (local.get $contrastHits) (i32.const 1)))))
        (if (i32.and
              (f64.ge (local.get $ca) (f64.const 6))
              (f64.ge (local.get $cb) (f64.const 6)))
          (then
            (local.set $balancedHits
              (f64.add (local.get $balancedHits) (f64.const 1)))))
        (local.set $contrastSum
          (f64.add (local.get $contrastSum)
            (f64.div
              (f64.max (f64.const 0) (f64.min (f64.const 80) (local.get $contrast)))
              (f64.const 80))))

        (if (f64.le (local.get $v) (f64.const 172))
          (then
            (local.set $dark (i32.add (local.get $dark) (i32.const 1)))
            (local.set $run (i32.add (local.get $run) (i32.const 1)))
            (local.set $longest
              (select (local.get $run) (local.get $longest)
                (i32.gt_s (local.get $run) (local.get $longest))))
            (if (i32.eqz (local.get $inSeg))
              (then
                (local.set $segments (i32.add (local.get $segments) (i32.const 1)))
                (local.set $inSeg (i32.const 1)))))
          (else
            (local.set $run (i32.const 0))
            (local.set $inSeg (i32.const 0))))
        (if (f64.le (local.get $v) (f64.const 112))
          (then (local.set $strong (i32.add (local.get $strong) (i32.const 1)))))
        (if (f64.le (local.get $v) (f64.const 178))
          (then
            (if (i32.or
                  (i32.lt_s (local.get $segmentStart) (i32.const 0))
                  (i32.and
                    (i32.ge_s (local.get $lastSegmentDark) (i32.const 0))
                    (i32.gt_s
                      (i32.sub (local.get $a) (local.get $lastSegmentDark))
                      (local.get $maxGap))))
              (then (local.set $segmentStart (local.get $a))))
            (local.set $lastSegmentDark (local.get $a))
            (if (i32.gt_s
                  (i32.sub (local.get $lastSegmentDark) (local.get $segmentStart))
                  (local.get $bestLen))
              (then
                (local.set $bestLen
                  (i32.sub (local.get $lastSegmentDark) (local.get $segmentStart)))
                (local.set $bestStart (local.get $segmentStart))
                (local.set $bestEnd (local.get $lastSegmentDark))))))
        (local.set $a (i32.add (local.get $a) (local.get $step)))
        (br $sample)))

    (if (i32.lt_s (local.get $n) (i32.const 16))
      (then (return (i32.const 0))))
    (local.set $support
      (f64.div (f64.convert_i32_s (local.get $dark)) (f64.convert_i32_s (local.get $n))))
    (local.set $continuity
      (f64.div (f64.convert_i32_s (local.get $longest)) (f64.convert_i32_s (local.get $n))))
    (if (i32.or
          (f64.lt (local.get $support) (f64.const 0.33))
          (f64.lt (local.get $continuity) (f64.const 0.17)))
      (then (return (i32.const 0))))
    (if (i32.or
          (i32.lt_s (local.get $bestStart) (i32.const 0))
          (i32.or
            (i32.lt_s (local.get $bestEnd) (i32.const 0))
            (f64.lt
              (f64.convert_i32_s (i32.sub (local.get $bestEnd) (local.get $bestStart)))
              (f64.max (f64.const 12)
                (f64.mul (local.get $alongSpan) (f64.const 0.15))))))
      (then (return (i32.const 0))))

    (local.set $strongRate
      (f64.div (f64.convert_i32_s (local.get $strong)) (f64.convert_i32_s (local.get $n))))
    (local.set $contrastRate
      (f64.div (f64.convert_i32_s (local.get $contrastHits)) (f64.convert_i32_s (local.get $n))))
    (local.set $balancedRate
      (f64.div (local.get $balancedHits) (f64.convert_i32_s (local.get $n))))
    (local.set $contrastMean
      (f64.div (local.get $contrastSum) (f64.convert_i32_s (local.get $n))))
    (local.set $outwardDist
      (if (result f64) (local.get $negative)
        (then (f64.sub (local.get $seedCross) (local.get $atTap)))
        (else (f64.sub (local.get $atTap) (local.get $seedCross)))))
    (local.set $nearestPenalty
      (f64.mul (f64.const 0.30)
        (f64.div
          (f64.max (f64.const 0) (local.get $outwardDist))
          (f64.max (f64.const 25) (local.get $outward)))))
    (local.set $fragmentationPenalty
      (f64.mul (f64.const 0.032)
        (f64.convert_i32_s
          (select
            (i32.sub (local.get $segments) (i32.const 4)) (i32.const 0)
            (i32.gt_s (i32.sub (local.get $segments) (i32.const 4)) (i32.const 0))))))
    (local.set $score
      (f64.sub
        (f64.sub
          (f64.add
            (f64.add
              (f64.add
                (f64.mul (local.get $support) (f64.const 2.30))
                (f64.mul (local.get $continuity) (f64.const 1.75)))
              (f64.add
                (f64.mul (local.get $strongRate) (f64.const 0.45))
                (f64.mul (local.get $contrastRate) (f64.const 0.90))))
            (f64.add
              (f64.mul (local.get $balancedRate) (f64.const 0.55))
              (f64.mul (local.get $contrastMean) (f64.const 0.70))))
          (local.get $nearestPenalty))
        (local.get $fragmentationPenalty)))

    (f64.store offset=0 (local.get $outPtr) (local.get $b))
    (f64.store offset=8 (local.get $outPtr) (local.get $atTap))
    (f64.store offset=16 (local.get $outPtr) (local.get $support))
    (f64.store offset=24 (local.get $outPtr) (local.get $continuity))
    (f64.store offset=32 (local.get $outPtr) (local.get $strongRate))
    (f64.store offset=40 (local.get $outPtr) (local.get $contrastRate))
    (f64.store offset=48 (local.get $outPtr) (local.get $balancedRate))
    (f64.store offset=56 (local.get $outPtr) (local.get $contrastMean))
    (f64.store offset=64 (local.get $outPtr) (local.get $score))
    (i32.store offset=72 (local.get $outPtr) (local.get $segments))
    (i32.store offset=76 (local.get $outPtr) (local.get $bestStart))
    (i32.store offset=80 (local.get $outPtr) (local.get $bestEnd))
    (i32.store offset=84 (local.get $outPtr)
      (i32.sub (local.get $bestEnd) (local.get $bestStart)))
    (i32.const 1))
)
