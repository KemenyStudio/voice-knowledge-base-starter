import SwiftUI

/// iPhone Duo: where a column should stop so text never sits on the hinge.
enum FoldLayout {
    /// Width left of a vertical fold that crosses this view, or nil when there
    /// is none (closed device, outer display, or a column beside the fold).
    static func leadingWidth(in proxy: GeometryProxy) -> CGFloat? {
        if #available(iOS 27.1, *) {
            guard let fold = proxy.reservedRegions(kind: .division).first else { return nil }
            let frame = fold.frame
            let crossesView = frame.minX > 0 && frame.maxX < proxy.size.width
            guard frame.height > frame.width, crossesView else { return nil }
            return frame.minX
        }
        return nil
    }
}

extension View {
    /// Centers a readable column, or keeps it on the leading side of the fold
    /// when iPhone Duo is partially folded across it. Only the width changes,
    /// so the layout moves as little as possible while folding.
    func foldSafeColumn(maxWidth: CGFloat, foldWidth: CGFloat?) -> some View {
        let width = foldWidth.map { min(maxWidth, $0) } ?? maxWidth
        return frame(maxWidth: width)
            .frame(maxWidth: .infinity, alignment: foldWidth == nil ? .center : .leading)
    }
}
