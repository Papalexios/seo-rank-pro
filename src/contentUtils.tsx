            if (replaceParent) {
                 (parent as Element).replaceWith(faqContainer);
            } else {
                // Sibling cleanup strategy
                const nodesToRemove: ChildNode[] = [existingFaqHeader];
                let sibling = existingFaqHeader.nextSibling;
                
                // Look ahead for up to 50 siblings or until next header
                let lookAhead = 0;
                while (sibling && lookAhead < 50) {
                    const el = sibling as Element;
                    const isHeader = sibling.nodeType === 1 && /^H[1-6]$/.test(el.tagName);
                    if (isHeader) break;
                    
                    nodesToRemove.push(sibling);
                    sibling = sibling.nextSibling;
                    lookAhead++;
                }
                
                // Insert new
                if (parent.contains(existingFaqHeader)) {
                    parent.insertBefore(faqContainer, existingFaqHeader);
                    nodesToRemove.forEach(n => n.remove());
                }
            }