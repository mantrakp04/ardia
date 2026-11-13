import ArdiaBrowser
import UIKit
import WebKit

extension PageContainerView {
  @objc func handleSwipe(_ recognizer: UIPanGestureRecognizer) {
    guard let webView, let page else { return }
    let width = bounds.width
    switch recognizer.state {
    case .began:
      let direction: SwipeNavigationDirection = recognizer.velocity(in: self).x > 0 ? .back : .forward
      let scrollPan = webView.scrollView.panGestureRecognizer
      scrollPan.isEnabled = false
      scrollPan.isEnabled = true
      let target: UIView
      if let image = page.snapshotForSwipe(direction) {
        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        target = imageView
      } else {
        target = UIView()
      }
      target.backgroundColor = webView.underPageBackgroundColor ?? .systemBackground
      target.frame = bounds
      let shade = UIView(frame: bounds)
      shade.backgroundColor = UIColor.black.withAlphaComponent(0.12)
      shade.isUserInteractionEnabled = false
      if direction == .back {
        insertSubview(target, belowSubview: webView)
        insertSubview(shade, aboveSubview: target)
        target.transform = CGAffineTransform(translationX: -width * Self.parallax, y: 0)
      } else {
        insertSubview(target, aboveSubview: webView)
        target.transform = CGAffineTransform(translationX: width, y: 0)
        target.layer.shadowColor = UIColor.black.cgColor
        target.layer.shadowOpacity = 0.18
        target.layer.shadowRadius = 12
        target.layer.shadowPath = UIBezierPath(rect: target.bounds).cgPath
        insertSubview(shade, belowSubview: target)
      }
      webView.layer.shadowColor = UIColor.black.cgColor
      webView.layer.shadowOpacity = direction == .back ? 0.18 : 0
      webView.layer.shadowRadius = 12
      webView.layer.shadowPath = UIBezierPath(rect: webView.bounds).cgPath
      swipe = SwipeState(direction: direction, target: target, shade: shade)
      swipeFeedback.prepare()
    case .changed:
      guard var swipe else { return }
      let raw = recognizer.translation(in: self).x
      layoutSwipe(swipe, progress: progress(for: raw, direction: swipe.direction))
      let signed = swipe.direction == .back ? raw : -raw
      let isPastCommit = swipe.isPastCommit ? signed > Self.commitDistance - Self.commitHysteresis : signed > Self.commitDistance
      if isPastCommit != swipe.isPastCommit {
        swipe.isPastCommit = isPastCommit
        self.swipe = swipe
      }
    case .ended, .cancelled, .failed:
      guard let swipe else { return }
      let raw = recognizer.translation(in: self).x
      let velocity = recognizer.velocity(in: self).x
      let signed = swipe.direction == .back ? raw : -raw
      let signedVelocity = swipe.direction == .back ? velocity : -velocity
      let commits = recognizer.state == .ended && (signed > Self.commitDistance && signedVelocity > -50 || signed > Self.flickDistance && signedVelocity > 600)
      finishSwipe(swipe, commit: commits, velocity: abs(velocity))
    default:
      break
    }
  }

  func progress(for translation: CGFloat, direction: SwipeNavigationDirection) -> CGFloat {
    let signed = direction == .back ? translation : -translation
    return min(max(signed / max(bounds.width, 1), 0), 1)
  }

  func layoutSwipe(_ swipe: SwipeState, progress: CGFloat) {
    guard let webView else { return }
    let width = bounds.width
    switch swipe.direction {
    case .back:
      webView.transform = CGAffineTransform(translationX: width * progress, y: 0)
      swipe.target.transform = CGAffineTransform(translationX: -width * Self.parallax * (1 - progress), y: 0)
      swipe.shade.alpha = 1 - progress
    case .forward:
      swipe.target.transform = CGAffineTransform(translationX: width * (1 - progress), y: 0)
      webView.transform = CGAffineTransform(translationX: -width * Self.parallax * progress, y: 0)
      swipe.shade.alpha = progress
    }
  }

  func finishSwipe(_ swipe: SwipeState, commit: Bool, velocity: CGFloat) {
    if commit { swipeFeedback.impactOccurred(intensity: 0.6) }
    let distance = max(bounds.width, 1)
    let initial = min(velocity / distance, 6)
    let animator = UIViewPropertyAnimator(duration: 0.22, timingParameters: UISpringTimingParameters(dampingRatio: 1, initialVelocity: CGVector(dx: initial, dy: 0)))
    animator.addAnimations { [self] in layoutSwipe(swipe, progress: commit ? 1 : 0) }
    let origin = page
    animator.addCompletion { [weak self] _ in
      guard let self else { return }
      self.swipeAnimator = nil
      self.webView?.transform = .identity
      self.webView?.layer.shadowOpacity = 0
      swipe.shade.removeFromSuperview()
      self.swipe = nil
      guard commit, let page = origin, page === self.page else {
        swipe.target.removeFromSuperview()
        return
      }
      self.bringSubviewToFront(swipe.target)
      swipe.target.transform = .identity
      swipe.target.layer.shadowOpacity = 0
      if swipe.direction == .back { page.goBack() } else { page.goForward() }
      UIView.animate(withDuration: 0.2, delay: 0.25, options: [.curveEaseOut, .allowUserInteraction]) {
        swipe.target.alpha = 0
      } completion: { _ in
        swipe.target.removeFromSuperview()
      }
    }
    swipeAnimator = animator
    animator.startAnimation()
  }

  func cancelSwipe() {
    swipeAnimator?.stopAnimation(true)
    swipeAnimator = nil
    guard let swipe else { return }
    swipe.target.removeFromSuperview()
    swipe.shade.removeFromSuperview()
    webView?.transform = .identity
    webView?.layer.shadowOpacity = 0
    self.swipe = nil
  }
}
